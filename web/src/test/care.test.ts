import fixtures from "./fixtures/p2-rules.json";
import repositoryFixtures from "./fixtures/p2-repository.json";
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SikmulwangDB, initializeDatabase } from '../lib/db/database';
import { createPlanting, purgePlanting } from '../lib/db/plantingRepository';
import { startCycle, endCycle } from '../lib/db/cycleRepository';
import { executeCare, effective, lastWatered, taskOrder, visibleTask, type CareCommand } from '../lib/care/repository';
import { addDays, canonical, evaluateSchedule as evaluate, evaluate as evaluateWithEvidence, normalizedInput, sha256, type RuleInput, type Rule } from '../lib/care/engine';
import type { TaskOccurrenceRecord } from '../lib/db/types';

const rule: Rule = {id:'rule',version:'1',kind:'SOIL_CHECK',inspectionDays:5,provenance:'PRODUCT_GUIDANCE'};
const input: RuleInput = {algorithmVersion:'rules-v1',generationId:'g',cycleId:'c',cycleStatus:'ACTIVE',startLocalDate:'2026-10-14',timeZone:'Asia/Seoul',nowUtc:'2026-10-14T00:00:00.000Z',environmentSnapshot:null,effectiveCareEvents:[],effectiveObservations:[],previousOccurrence:null,weather:null};
describe('P2 deterministic rules',() => {
  it('evaluate returns reproducible SHA-256 evidence',async () => {
    const a = await evaluateWithEvidence(input,rule), b = await evaluateWithEvidence(input,rule);
    expect(a).toEqual(b); expect(a.evidence.inputDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(a.evidence.ruleSnapshotHash).toBe(await sha256(canonical(rule)));
  });
  for (const fixture of fixtures) it(`${fixture.id} fixed JSON golden`,() => {
    const i: RuleInput = {...input,cycleStatus:fixture.kind === 'ENDED' ? 'ENDED' : 'ACTIVE',previousOccurrence:fixture.seq === null ? null : {id:'c/SOIL_CHECK/'+fixture.seq,occurrenceSeq:fixture.seq,status:fixture.kind === 'SNOOZED' ? 'SNOOZED' : 'OPEN',dueLocalDate:fixture.due!},effectiveCareEvents:fixture.kind === 'WATERED' ? [{id:'e',kind:'WATERED',occurredAt:fixture.occurredAt!}] : [],effectiveObservations:fixture.kind === 'MOIST' ? [{id:'o',kind:'MOIST',occurredAt:fixture.occurredAt!}] : []};
    expect(evaluate(i,fixture.kind === 'MISSING' ? null : rule)).toMatchObject({dueLocalDate:fixture.due,occurrenceSeq:fixture.seq});
  });
  it('RULE-01 initial cycle and RULE-11 missing rule',() => {
    expect(evaluate(input,rule)).toMatchObject({occurrenceSeq:0,dueLocalDate:'2026-10-14',recommendationState:'INSPECTION_DUE'});
    expect(evaluate(input,null)).toMatchObject({dueLocalDate:null,recommendationState:'UNKNOWN',reasonCodes:['RULE_MISSING']});
  });
  it('RULE-12 ended cycle and RULE-13 explicit invalid interval',() => {
    expect(evaluate({...input,cycleStatus:'ENDED'},rule).taskKind).toBe('NONE');
    for (const inspectionDays of [0,31,1.5,NaN,Infinity]) expect(() => evaluate(input,{...rule,inspectionDays})).toThrow();
  });
  it('RULE-02/03 WATERED and MOIST use confirmed occurrence date',() => {
    expect(evaluate({...input,effectiveCareEvents:[{id:'a',kind:'WATERED',occurredAt:'2026-10-14T00:00:00Z'}]},rule).dueLocalDate).toBe('2026-10-19');
    expect(evaluate({...input,effectiveObservations:[{id:'b',kind:'MOIST',occurredAt:'2026-10-14T00:00:00Z'}]},rule).dueLocalDate).toBe('2026-10-16');
  });
  it('RULE-14/20 array order produces identical normalized digest and output',async () => {
    const a: RuleInput = {...input,effectiveCareEvents:[{id:'b',kind:'WATERED',occurredAt:'2026-10-12T00:00:00Z'},{id:'a',kind:'WATERED',occurredAt:'2026-10-10T00:00:00Z'}]};
    const b = {...a,effectiveCareEvents:[...a.effectiveCareEvents].reverse()};
    expect(evaluate(a,rule)).toEqual(evaluate(b,rule));
    expect(await sha256(canonical(normalizedInput(a)))).toBe(await sha256(canonical(normalizedInput(b))));
  });
  it('RULE-09/10 weather never changes dates, expiration is exclusive',() => {
    for (const nowUtc of ['2026-10-14T00:00:00Z','2026-10-15T00:00:00Z']) {
      const output = evaluate({...input,nowUtc,weather:{issuedAt:'2026-10-14T00:00:00Z',expiresAt:'2026-10-15T00:00:00Z',rainMm:100}},rule);
      expect(output.dueLocalDate).toBe('2026-10-14');
      expect(output.reasonCodes).toContain(nowUtc.startsWith('2026-10-15') ? 'WEATHER_STALE' : 'WEATHER_NOT_APPLIED');
    }
  });
  it('calendar addition and timezone midnight/DST',() => {
    expect(addDays('2026-03-07',2)).toBe('2026-03-09');
    expect(evaluate({...input,timeZone:'America/New_York',effectiveCareEvents:[{id:'dst',kind:'WATERED',occurredAt:'2026-03-08T04:30:00Z'}]},rule).dueLocalDate).toBe('2026-03-12');
  });
});

describe('P2 atomic repositories',() => {
  let db: SikmulwangDB, generation: string, epoch: number, cycleId: string;
  const now = '2026-10-20T03:00:00.000Z';
  beforeEach(async () => {
    vi.useFakeTimers({toFake:['Date']}); vi.setSystemTime(new Date(now));
    db = new SikmulwangDB(`p2-${crypto.randomUUID()}`);
    const meta = await initializeDatabase(db); generation = meta.activeGenerationId; epoch = meta.epoch;
    const plant = await createPlanting(db,epoch,generation,{displayName:'P2 식물',locationId:'loc_indoor_living',groupType:'INDIVIDUAL',quantity:1,unit:'개'});
    const cycle = await startCycle(db,epoch,generation,{plantingId:plant.planting.id,startLocalDate:'2026-10-01'}); cycleId = cycle.id;
  });
  afterEach(async () => {vi.useRealTimers(); await db.delete();});
  const run = (kind: CareCommand['kind'], task?: TaskOccurrenceRecord, extra: Partial<CareCommand> = {}) => executeCare(db,epoch,generation,{kind,cycleId,taskId:task?.id,expectedRevision:task?.revision ?? 1,idempotencyKey:crypto.randomUUID(),occurredAt:now,...extra});
  const tasks = () => db.taskOccurrences.toArray();
  const setup = async () => {await run('RULE',undefined,{inspectionDays:5}); return (await tasks())[0];};
  const state = async () => canonical(await Promise.all(db.tables.map(t => t.toArray())));
  for (const fixture of repositoryFixtures) it(`${fixture.id} repository fixed JSON golden`,async () => {
    await setup();
    const revisions = new Map<string,number>();
    for (const command of fixture.commands) {
      const task = (await tasks()).find(t => t.occurrenceSeq === command.seq)!;
      if (!revisions.has(command.key)) revisions.set(command.key,task.revision);
      await run(command.kind as CareCommand['kind'],task,{expectedRevision:revisions.get(command.key)!,idempotencyKey:command.key,occurredAt:command.at,...(command.kind === 'UNDO' ? {targetId:task.resolutionId!,targetType:'CARE_EVENT' as const} : {})});
    }
    expect(await db.careEvents.count()).toBe(fixture.events); expect(await db.observations.count()).toBe(fixture.observations);
    expect(lastWatered(await db.careEvents.toArray())).toBe(fixture.lastWatered);
    expect((await tasks()).filter(t => ['OPEN','SNOOZED'].includes(t.status))).toMatchObject([{occurrenceSeq:fixture.openSeq,dueLocalDate:fixture.due}]);
  });
  it('RULE-18 explicit interval creates seq0, immutable snapshot and decision',async () => {
    const task = await setup(); expect(task.dueLocalDate).toBe('2026-10-01');
    expect(await db.ruleSnapshots.count()).toBe(1); expect(await db.decisionLogs.count()).toBe(1);
    expect((await db.careRules.toArray())[0].provenance).toBe('USER_OVERRIDE');
    const savedRule = (await db.careRules.toArray())[0];
    await db.careRules.add({...savedRule,id:'product-newer',provenance:'PRODUCT_GUIDANCE',inspectionDays:30,revision:100});
    await run('WATERED',task);
    expect((await tasks()).find(t => t.occurrenceSeq === 1)?.dueLocalDate).toBe('2026-10-25');
  });
  it('RULE-02/05/06 concurrent same/different keys resolve once',async () => {
    const task = await setup(), key = crypto.randomUUID();
    await Promise.all([run('WATERED',task,{idempotencyKey:key}),run('WATERED',task,{idempotencyKey:key}),run('WATERED',task)]);
    expect(await db.careEvents.count()).toBe(1);
    expect((await tasks()).filter(t => t.status === 'RESOLVED')).toHaveLength(1);
    expect((await tasks()).find(t => t.occurrenceSeq === 1)?.dueLocalDate).toBe('2026-10-25');
  });
  it('RULE-03 MOIST is observation only',async () => {
    const task = await setup(); await run('MOIST',task);
    expect(await db.careEvents.count()).toBe(0); expect(await db.observations.count()).toBe(1);
    expect((await tasks()).find(t => t.occurrenceSeq === 1)?.dueLocalDate).toBe('2026-10-22');
    expect(lastWatered(await db.careEvents.toArray())).toBeNull();
  });
  it('RULE-04 snooze retains identity and has no fake resolution',async () => {
    const task = await setup(); await run('SNOOZED',task,{dueLocalDate:'2026-10-23'});
    expect(await tasks()).toHaveLength(1); expect((await tasks())[0]).toMatchObject({id:task.id,occurrenceSeq:0,status:'SNOOZED',resolutionId:null,dueLocalDate:'2026-10-23'});
    expect(await db.careEvents.count()).toBe(0); expect(await db.observations.count()).toBe(0);
    await run('UNSNOOZE',(await tasks())[0]);
    expect((await tasks())[0]).toMatchObject({id:task.id,status:'OPEN',dueLocalDate:'2026-10-01'});
  });
  it('RULE-15 stable priority sort top three',async () => {
    const base = await setup();
    const items = [4,2,3,1,5].map(n => ({...base,id:String(n),cycleId:String(n),priority:n === 5 ? 1 : 0}));
    expect(items.sort(taskOrder).slice(0,3).map(t => t.id)).toEqual(['5','1','2']);
  });
  it('missing rule permits direct facts and append-only corrections without invented tasks',async () => {
    const key = crypto.randomUUID(); await run('WATERED',undefined,{idempotencyKey:key});
    await run('WATERED',undefined,{idempotencyKey:key});
    expect(await db.careEvents.count()).toBe(1); expect(await db.taskOccurrences.count()).toBe(0);
    const first = (await db.careEvents.toArray())[0];
    expect(JSON.parse((await db.decisionLogs.toArray())[0].outputSnapshot).recommendationState).toBe('UNKNOWN');
    await run('CORRECT',undefined,{expectedRevision:2,targetId:first.id,targetType:'CARE_EVENT',occurredAt:'2026-10-19T00:00:00Z'});
    const head = effective(await db.careEvents.toArray())[0];
    await run('UNDO',undefined,{expectedRevision:3,targetId:head.id,targetType:'CARE_EVENT'});
    expect(lastWatered(await db.careEvents.toArray())).toBeNull(); expect(await db.careEvents.get([generation,first.id])).toEqual(first);
    await run('RULE',undefined,{expectedRevision:4,inspectionDays:3}); expect(await db.taskOccurrences.count()).toBe(1);
  });
  it('future cycle allows interval setup without recording imaginary care',async () => {
    const cycle = (await db.cycles.toArray())[0]; await db.cycles.put({...cycle,startLocalDate:'2026-10-21'});
    const task = await setup(); expect(task.dueLocalDate).toBe('2026-10-21');
    await expect(run('WATERED',task)).rejects.toThrow(); expect(await db.careEvents.count()).toBe(0);
  });
  it('P1 purge preserves P2 history and references',async () => {
    await setup(); const cycle = (await db.cycles.toArray())[0]; const plant = (await db.plantings.toArray())[0];
    const before = await state(); await expect(purgePlanting(db,epoch,generation,cycle.plantingId,plant.revision)).rejects.toThrow('관리 이력');
    expect(await state()).toBe(before);
  });
  it('invalid interval, stale revision, invalid date and malformed task roll back',async () => {
    let before = await state(); await expect(run('RULE',undefined,{inspectionDays:31})).rejects.toThrow(); expect(await state()).toBe(before);
    await expect(run('MOIST',undefined,{targetType:'CARE_EVENT'})).rejects.toThrow(); expect(await state()).toBe(before);
    const task = await setup(); before = await state();
    await expect(run('WATERED',task,{expectedRevision:999})).rejects.toThrow(); expect(await state()).toBe(before);
    await expect(run('WATERED',task,{occurredAt:'2026-02-30T00:00:00Z'})).rejects.toThrow(); expect(await state()).toBe(before);
    await db.taskOccurrences.update([generation,task.id],{status:'BOGUS'}); before = await state();
    await expect(run('WATERED',task)).rejects.toThrow(); expect(await state()).toBe(before);
  });
  it('different-key completion receipt cannot re-complete an undone task on retry',async () => {
    const task = await setup(); await run('WATERED',task);
    const key = crypto.randomUUID(); await run('MOIST',task,{idempotencyKey:key});
    const resolved = (await tasks()).find(t => t.id === task.id)!;
    await run('UNDO',resolved,{targetId:resolved.resolutionId!,targetType:'CARE_EVENT'});
    const before = await state(); await run('MOIST',task,{idempotencyKey:key}); expect(await state()).toBe(before);
  });
  it('correction cycle and branch are rejected',async () => {
    await run('WATERED',await setup()); const row = (await db.careEvents.toArray())[0];
    expect(() => effective([{...row,correctionOfId:row.id}])).toThrow('순환');
    expect(() => effective([row,{...row,id:'b',correctionOfId:row.id},{...row,id:'c',correctionOfId:row.id}])).toThrow('정정');
  });
  it('RULE-07/08 past events, undo and re-completion preserve slots and logs',async () => {
    await run('WATERED',await setup(),{occurredAt:'2026-10-12T00:00:00Z'});
    let next = (await tasks()).find(t => t.occurrenceSeq === 1)!;
    await run('WATERED',next,{occurredAt:'2026-10-10T00:00:00Z'});
    expect(lastWatered(await db.careEvents.toArray())).toBe('2026-10-12T00:00:00.000Z');
    const frozen = await db.decisionLogs.toArray();
    next = (await tasks()).find(t => t.occurrenceSeq === 1)!;
    await run('UNDO',next,{targetId:next.resolutionId!,targetType:'CARE_EVENT'});
    const reopened = (await tasks()).find(t => t.id === next.id)!;
    expect(reopened.status).toBe('OPEN'); expect((await tasks()).filter(t => ['OPEN','SNOOZED'].includes(t.status))).toHaveLength(1);
    await run('WATERED',reopened);
    expect(await tasks()).toHaveLength(3);
    for (const log of frozen) expect(await db.decisionLogs.get([generation,log.id])).toEqual(log);
  });
  it('observation correction and undo append records without overwriting',async () => {
    await run('MOIST',await setup());
    let resolved = (await tasks()).find(t => t.status === 'RESOLVED')!;
    const original = (await db.observations.toArray())[0];
    await run('CORRECT',resolved,{targetId:original.id,targetType:'OBSERVATION',occurredAt:'2026-10-19T00:00:00Z'});
    resolved = (await tasks()).find(t => t.status === 'RESOLVED')!;
    await run('UNDO',resolved,{targetId:resolved.resolutionId!,targetType:'OBSERVATION'});
    expect(await db.observations.get([generation,original.id])).toEqual(original);
    expect(await db.observations.count()).toBe(3); expect(effective(await db.observations.toArray())).toHaveLength(0);
  });
  it('past undo with completed descendants fails atomically',async () => {
    await run('WATERED',await setup());
    await run('MOIST',(await tasks()).find(t => t.occurrenceSeq === 1)!);
    const original = (await tasks()).find(t => t.occurrenceSeq === 0)!;
    const before = await state();
    await expect(run('UNDO',original,{targetId:original.resolutionId!,targetType:'CARE_EVENT'})).rejects.toThrow('후속 완료');
    expect(await state()).toBe(before);
  });
  it('mid-transaction hash failure rolls back every store',async () => {
    const task = await setup(), before = await state();
    const spy = vi.spyOn(crypto.subtle,'digest').mockRejectedValueOnce(new Error('crypto failure'));
    await expect(run('WATERED',task)).rejects.toThrow(); spy.mockRestore(); expect(await state()).toBe(before);
  });
  it('RULE-19 stale epoch, fence and R5 damage block writes',async () => {
    const task = await setup();
    for (const [key,value] of [['epoch',2],['writeFence',true]] as const) {
      const old = await db.meta.get(key); await db.meta.put({key,value,updatedAt:now}); const before = await state();
      await expect(run('WATERED',task)).rejects.toThrow(); expect(await state()).toBe(before); await db.meta.put(old!);
    }
    await db.generationRegistry.update(generation,{state:'ARCHIVED'}); const before = await state();
    await expect(run('WATERED',task)).rejects.toThrow(); expect(await state()).toBe(before);
  });
  for (const damage of ['missing-profile','missing-generation','profile-mismatch','schema-mismatch','missing-meta'] as const) it(`P2 R5 ${damage} leaves every store unchanged`,async () => {
    const task = await setup();
    if (damage === 'missing-profile') await db.profiles.delete('p_default');
    if (damage === 'missing-generation') await db.generationRegistry.delete(generation);
    if (damage === 'profile-mismatch') await db.generationRegistry.update(generation,{profileId:'other-profile'});
    if (damage === 'schema-mismatch') await db.meta.put({key:'schemaVersion',value:999,updatedAt:now});
    if (damage === 'missing-meta') await db.meta.delete('epoch');
    const before = await state(); await expect(run('WATERED',task)).rejects.toThrow(); expect(await state()).toBe(before);
  });
  it('ended season hides tasks and rejects recording',async () => {
    const task = await setup(); const cycle = (await db.cycles.toArray())[0];
    await endCycle(db,epoch,generation,{cycleId,endLocalDate:'2026-10-20',expectedRevision:cycle.revision});
    expect(visibleTask(task,await db.cycles.toArray())).toBe(false); await expect(run('WATERED',task)).rejects.toThrow();
  });
});
