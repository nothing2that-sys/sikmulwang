import Dexie from 'dexie';
import type { SikmulwangDB } from '../db/database';
import type { CareEventRecord, ObservationRecord, TaskOccurrenceRecord, CycleRecord } from '../db/types';
import { withWriteTransaction } from '../db/transaction';
import { verifyRuleSnapshot } from '../db/writerCompatibility';
import { ConflictError, ValidationError } from '../db/errors';
import { validateEffectiveTimestamp, validateExpectedRevision, validateLocalDate } from '../db/validators';
import { canonical, compare, evaluate, factOrder, interval, localDate, type Fact, type Rule, type RuleInput } from './engine';

type Row = CareEventRecord | ObservationRecord;
const metadata = (now: string) => ({createdAt:now,updatedAt:now,revision:1,schemaVersion:1});
export function effective<T extends Row>(rows: T[]): T[] {
  const ids = new Map(rows.map(r => [r.id,r]));
  const children = new Set<string>();
  for (const row of rows) {
    validateEffectiveTimestamp(row.occurredAt);
    if (!['ACTIVE','VOID'].includes(row.eventStatus)) throw new ValidationError('지원하지 않는 기록 상태입니다.');
    if (!row.correctionOfId) continue;
    const parent = ids.get(row.correctionOfId);
    if (!parent || parent.cycleId !== row.cycleId || children.has(parent.id)) throw new ValidationError('정정 참조가 손상되었습니다.');
    children.add(parent.id);
    const seen = new Set([row.id]);
    let current: Row | undefined = parent;
    while (current) {
      if (seen.has(current.id)) throw new ValidationError('정정 순환은 허용되지 않습니다.');
      seen.add(current.id); current = current.correctionOfId ? ids.get(current.correctionOfId) : undefined;
    }
  }
  return rows.filter(r => !children.has(r.id) && r.eventStatus === 'ACTIVE');
}
function facts(events: CareEventRecord[], observations: ObservationRecord[]): Fact[] {
  if (events.some(e => e.actionKind !== 'WATERED') || observations.some(o => o.observationKind !== 'MOIST' || o.value !== 'MOIST')) throw new ValidationError('지원하지 않는 관리 기록 유형입니다.');
  return [...effective(events).map(r => ({id:r.id,kind:'WATERED' as const,occurredAt:r.occurredAt})), ...effective(observations).map(r => ({id:r.id,kind:'MOIST' as const,occurredAt:r.occurredAt}))].sort(factOrder);
}
export interface CareCommand {
  cycleId: string; taskId?: string; expectedRevision: number; idempotencyKey: string;
  kind: 'RULE' | 'WATERED' | 'MOIST' | 'SNOOZED' | 'UNSNOOZE' | 'UNDO' | 'CORRECT';
  occurredAt: string; inspectionDays?: number; dueLocalDate?: string;
  targetId?: string; targetType?: 'CARE_EVENT' | 'OBSERVATION';
}
export async function executeCare(db: SikmulwangDB, epoch: number, generation: string, command: CareCommand) {
  validateExpectedRevision(command.expectedRevision);
  const occurredAt = validateEffectiveTimestamp(command.occurredAt);
  if (!command.idempotencyKey?.trim() || !['RULE','WATERED','MOIST','SNOOZED','UNSNOOZE','UNDO','CORRECT'].includes(command.kind)) throw new ValidationError('잘못된 관리 요청입니다.');
  const correction = command.kind === 'UNDO' || command.kind === 'CORRECT';
  if (correction ? (!command.targetId || !['CARE_EVENT','OBSERVATION'].includes(command.targetType!)) : (command.targetId !== undefined || command.targetType !== undefined)) throw new ValidationError('정정 대상은 정정 요청에만 지정해야 합니다.');
  if ((command.kind !== 'RULE' && command.inspectionDays !== undefined) || (command.kind !== 'SNOOZED' && command.dueLocalDate !== undefined)) throw new ValidationError('요청 종류와 입력 필드가 일치하지 않습니다.');
  if (command.kind === 'RULE') interval(command.inspectionDays!);
  if (command.kind === 'SNOOZED') validateLocalDate(command.dueLocalDate!);
  const requestBody = canonical(command);
  return withWriteTransaction(db,[db.cycles,db.plantings,db.locations,db.careEvents,db.observations,db.taskOccurrences,db.taskChanges,db.careRules,db.ruleSnapshots,db.decisionLogs],epoch,generation,async ({generationId,nowUtc}) => {
    const prior = await db.taskChanges.where('generationId').equals(generationId).filter(r => r.idempotencyKey === command.idempotencyKey).first();
    if (prior) {
      if (prior.requestBody !== requestBody) throw new ValidationError('재시도 키가 다른 요청에 사용되었습니다.');
      return db.taskOccurrences.get([generationId,prior.taskId]);
    }
    const receipt = await db.decisionLogs.where('generationId').equals(generationId).filter(r => r.idempotencyKey === command.idempotencyKey).first();
    if (receipt) {
      if (receipt.requestBody !== requestBody) throw new ValidationError('재시도 키가 다른 요청에 사용되었습니다.');
      return receipt.resultTaskId ? db.taskOccurrences.get([generationId,receipt.resultTaskId]) : undefined;
    }
    const cycle = await db.cycles.get([generationId,command.cycleId]);
    if (!cycle || cycle.status !== 'ACTIVE' || cycle.recordStatus !== 'ACTIVE') throw new ValidationError('활성 시즌이 필요합니다.');
    const planting = await db.plantings.get([generationId,cycle.plantingId]);
    const location = planting && await db.locations.get([generationId,planting.locationId]);
    if (!planting || planting.recordStatus !== 'ACTIVE' || !location || location.recordStatus !== 'ACTIVE') throw new ValidationError('활성 식물과 장소가 필요합니다.');
    if ((['WATERED','MOIST','CORRECT'].includes(command.kind) && localDate(occurredAt,cycle.timeZone) < cycle.startLocalDate) || occurredAt > nowUtc) throw new ValidationError('발생 시각은 시즌 시작 이후부터 현재까지여야 합니다.');
    const tasks = await db.taskOccurrences.where('generationId').equals(generationId).filter(t => t.cycleId === cycle.id).toArray();
    if (new Set(tasks.map(t => t.occurrenceSeq)).size !== tasks.length) throw new ValidationError('발생 키가 중복되었습니다.');
    if (tasks.filter(t => ['OPEN','SNOOZED'].includes(t.status)).length > 1) throw new ValidationError('미해결 태스크가 중복되었습니다.');
    for (const t of tasks) {
      if (t.actionKind !== 'SOIL_CHECK' || !['OPEN','SNOOZED','RESOLVED','CANCELLED'].includes(t.status) || !Number.isInteger(t.occurrenceSeq) || t.occurrenceSeq < 0 || t.id !== `${cycle.id}/SOIL_CHECK/${t.occurrenceSeq}`) throw new ValidationError('태스크 상태가 손상되었습니다.');
      validateExpectedRevision(t.revision); validateLocalDate(t.dueLocalDate);
      if (!Number.isFinite(t.priority)) throw new ValidationError('태스크 우선순위가 손상되었습니다.');
      if (['OPEN','SNOOZED','CANCELLED'].includes(t.status) && (t.resolutionId !== null || t.resolutionType !== null)) throw new ValidationError('미해결 태스크의 resolution이 손상되었습니다.');
    }
    let task = tasks.find(t => t.id === command.taskId);
    let events = await db.careEvents.where('generationId').equals(generationId).filter(r => r.cycleId === cycle.id).toArray();
    let observations = await db.observations.where('generationId').equals(generationId).filter(r => r.cycleId === cycle.id).toArray();
    facts(events,observations);
    for (const t of tasks.filter(t => t.status === 'RESOLVED')) {
      const rows = t.resolutionType === 'CARE_EVENT' ? effective(events) : t.resolutionType === 'OBSERVATION' ? effective(observations) : [];
      if (!rows.some(r => r.id === t.resolutionId)) throw new ValidationError('유효한 resolution 참조가 필요합니다.');
    }
    for (const store of [db.careEvents,db.observations]) {
      if ((await store.where('generationId').equals(generationId).toArray()).some(r => r.idempotencyKey === command.idempotencyKey)) throw new ValidationError('기존 기록에 사용된 재시도 키입니다.');
    }
    const before = canonical(tasks);
    const ruleRows = await db.careRules.where('generationId').equals(generationId).filter(r => r.cycleId === cycle.id).toArray();
    let ruleRow = ruleRows.sort((a,b) => Number(b.provenance === 'USER_OVERRIDE')-Number(a.provenance === 'USER_OVERRIDE') || b.revision-a.revision || compare(b.id,a.id))[0];
    const sourceId = crypto.randomUUID();
    if (command.kind === 'RULE') {
      if (cycle.revision !== command.expectedRevision) throw new ConflictError();
      ruleRow = {generationId,id:sourceId,version:String((ruleRow?.revision ?? 0)+1),actionKind:'SOIL_CHECK',inspectionDays:command.inspectionDays!,cycleId:cycle.id,applicability:'CYCLE',provenance:'USER_OVERRIDE',...metadata(nowUtc),revision:(ruleRow?.revision ?? 0)+1};
      await db.careRules.add(ruleRow);
      await db.cycles.put({...cycle,revision:cycle.revision+1,updatedAt:nowUtc});
    } else if (!command.taskId) {
      if (cycle.revision !== command.expectedRevision) throw new ConflictError();
      if (!['WATERED','MOIST','UNDO','CORRECT'].includes(command.kind)) throw new ValidationError('직접 기록에는 행위 또는 관찰이 필요합니다.');
      let target: Row | undefined;
      if (command.kind === 'UNDO' || command.kind === 'CORRECT') {
        const rows = command.targetType === 'CARE_EVENT' ? events : command.targetType === 'OBSERVATION' ? observations : [];
        target = effective<Row>(rows).find(r => r.id === command.targetId);
        if (!target || tasks.some(t => t.resolutionId === target!.id)) throw new ConflictError('유효한 직접 기록만 정정할 수 있습니다.');
      }
      const body = {generationId,id:sourceId,cycleId:cycle.id,occurredAt:command.kind === 'UNDO' ? target!.occurredAt : occurredAt,idempotencyKey:command.idempotencyKey,correctionOfId:target?.id ?? null,eventStatus:command.kind === 'UNDO' ? 'VOID' : 'ACTIVE',...metadata(nowUtc)};
      if (command.kind === 'WATERED' || (correction && command.targetType === 'CARE_EVENT')) {
        const row: CareEventRecord = {...body,actionKind:'WATERED'};
        await db.careEvents.add(row); events.push(row);
      } else {
        const row: ObservationRecord = {...body,observationKind:'MOIST',value:'MOIST'};
        await db.observations.add(row); observations.push(row);
      }
      await db.cycles.put({...cycle,revision:cycle.revision+1,updatedAt:nowUtc});
    } else {
      if (!task) throw new ValidationError('관리 작업을 찾을 수 없습니다.');
      if ((command.kind === 'WATERED' || command.kind === 'MOIST') && task.status === 'RESOLVED') {
        //+_+// Persist the no-op receipt so its retry cannot re-complete a later reopened slot.
        await db.taskChanges.add({generationId,id:crypto.randomUUID(),taskId:task.id,previousState:before,nextState:before,sourceId:task.resolutionId!,idempotencyKey:command.idempotencyKey,requestBody,occurredAt:nowUtc,...metadata(nowUtc)});
        return task;
      }
      if (task.revision !== command.expectedRevision) throw new ConflictError();
      if (command.kind === 'UNSNOOZE') {
        if (task.status !== 'SNOOZED') throw new ConflictError('연기된 작업이 아닙니다.');
        task = {...task,status:'OPEN'};
      } else if (command.kind === 'UNDO' || command.kind === 'CORRECT') {
        if (!['CARE_EVENT','OBSERVATION'].includes(command.targetType!)) throw new ValidationError('정정 유형이 필요합니다.');
        const rows = command.targetType === 'CARE_EVENT' ? events : observations;
        const target = rows.find(r => r.id === command.targetId);
        if (!target || !effective<Row>(rows).some(r => r.id === target.id)) throw new ConflictError('이미 정정되었거나 유효하지 않은 기록입니다.');
        if (command.kind === 'UNDO' && tasks.some(t => t.occurrenceSeq > task!.occurrenceSeq && t.status === 'RESOLVED')) throw new ConflictError('후속 완료 기록부터 되돌려 주세요.');
        const rootTask = tasks.find(t => t.resolutionId === target.id);
        if (!rootTask || rootTask.id !== task.id) throw new ValidationError('태스크와 정정 대상이 일치하지 않습니다.');
        const next = {...target,id:sourceId,correctionOfId:target.id,eventStatus:command.kind === 'UNDO' ? 'VOID' : 'ACTIVE',occurredAt:command.kind === 'UNDO' ? target.occurredAt : occurredAt,idempotencyKey:command.idempotencyKey,...metadata(nowUtc)};
        if (command.targetType === 'CARE_EVENT') { await db.careEvents.add(next as CareEventRecord); events = [...events,next as CareEventRecord]; }
        else { await db.observations.add(next as ObservationRecord); observations = [...observations,next as ObservationRecord]; }
        task = {...task,status:command.kind === 'UNDO' ? 'OPEN' : 'RESOLVED',resolutionId:command.kind === 'UNDO' ? null : sourceId,resolutionType:command.kind === 'UNDO' ? null : command.targetType!};
      } else {
        if (!['OPEN','SNOOZED'].includes(task.status)) throw new ConflictError('이 작업은 더 이상 실행할 수 없습니다.');
        if (command.kind === 'SNOOZED') {
          if (command.dueLocalDate! <= localDate(nowUtc,cycle.timeZone)) throw new ValidationError('연기 날짜는 오늘 이후여야 합니다.');
          task = {...task,status:'SNOOZED',dueLocalDate:command.dueLocalDate!};
        } else if (command.kind === 'WATERED') {
          const row: CareEventRecord = {generationId,id:sourceId,cycleId:cycle.id,actionKind:'WATERED',occurredAt,idempotencyKey:command.idempotencyKey,correctionOfId:null,eventStatus:'ACTIVE',...metadata(nowUtc)};
          await db.careEvents.add(row); events.push(row);
          task = {...task,status:'RESOLVED',resolutionType:'CARE_EVENT',resolutionId:sourceId};
        } else {
          const row: ObservationRecord = {generationId,id:sourceId,cycleId:cycle.id,observationKind:'MOIST',value:'MOIST',occurredAt,idempotencyKey:command.idempotencyKey,correctionOfId:null,eventStatus:'ACTIVE',...metadata(nowUtc)};
          await db.observations.add(row); observations.push(row);
          task = {...task,status:'RESOLVED',resolutionType:'OBSERVATION',resolutionId:sourceId};
        }
      }
      if (!task) throw new ValidationError("관리 작업이 필요합니다.");
      task = {...task,revision:task.revision+1,updatedAt:nowUtc};
      await db.taskOccurrences.put(task);
      tasks.splice(tasks.findIndex(t => t.id === task!.id),1,task);
    }
    const rule: Rule | null = ruleRow ? {id:ruleRow.id,version:ruleRow.version,kind:'SOIL_CHECK',inspectionDays:ruleRow.inspectionDays!,provenance:ruleRow.provenance as Rule['provenance']} : null;
    const allFacts = facts(events,observations);
    const unresolved = tasks.filter(t => t.status === 'OPEN' || t.status === 'SNOOZED').sort((a,b) => a.occurrenceSeq-b.occurrenceSeq);
    let current = unresolved[0];
    if (!current) {
      const seq = Math.max(-1,...tasks.filter(t => t.status === 'RESOLVED').map(t => t.occurrenceSeq))+1;
      current = tasks.find(t => t.occurrenceSeq === seq) ?? {generationId,id:`${cycle.id}/SOIL_CHECK/${seq}`,cycleId:cycle.id,actionKind:'SOIL_CHECK',priority:0,occurrenceSeq:seq,anchorId:'cycle-start',dueLocalDate:cycle.startLocalDate,status:'OPEN',resolutionType:null,resolutionId:null,...metadata(nowUtc)};
      current = {...current,status:'OPEN',resolutionType:null,resolutionId:null};
    }
    const input: RuleInput = {algorithmVersion:'rules-v1',nowUtc,timeZone:cycle.timeZone,generationId,cycleId:cycle.id,cycleStatus:cycle.status,startLocalDate:cycle.startLocalDate,environmentSnapshot:location,effectiveCareEvents:allFacts.filter(f => f.kind === 'WATERED'),effectiveObservations:allFacts.filter(f => f.kind === 'MOIST'),previousOccurrence:rule ? current : null,weather:null};
    const output = await Dexie.waitFor(evaluate(input,rule));
    if (output.dueLocalDate && rule) {
      current = {...current,dueLocalDate:output.dueLocalDate,anchorId:allFacts.at(-1)?.id ?? 'cycle-start',revision:current.revision+1,updatedAt:nowUtc};
      await db.taskOccurrences.put(current);
      for (const extra of unresolved.slice(1)) await db.taskOccurrences.put({...extra,status:'CANCELLED',resolutionType:null,resolutionId:null,revision:extra.revision+1,updatedAt:nowUtc});
    }
    const inputSnapshot = canonical(input), ruleBody = canonical(rule);
    const {inputDigest,ruleSnapshotHash} = output.evidence;
    const snapshotId = rule?.id ?? null;
    if (rule && snapshotId) {
      const snapshot = await db.ruleSnapshots.get([generationId,snapshotId]);
      const legacySnapshot = await db.ruleSnapshots.get([generationId,`rule/${rule.id}`]);
      if (snapshot) await verifyRuleSnapshot(snapshot,ruleBody);
      if (legacySnapshot) await verifyRuleSnapshot(legacySnapshot,ruleBody);
      if (!snapshot) await db.ruleSnapshots.add({generationId,id:snapshotId,stableRuleId:rule.id,version:rule.version,normalizedBody:ruleBody,sha256:ruleSnapshotHash,...metadata(nowUtc)});
    }
    const resultTaskId = rule ? (task?.id ?? current.id) : null;
    await db.decisionLogs.add({generationId,id:crypto.randomUUID(),targetType:rule ? 'TASK' : 'CARE_RECORD',targetId:rule ? current.id : sourceId,algorithmVersion:'rules-v1',inputSnapshot,inputDigest,ruleSnapshotHash,ruleSnapshotIds:snapshotId ? [snapshotId] : [],outputSnapshot:canonical(output),evaluatedAt:nowUtc,idempotencyKey:command.idempotencyKey,requestBody,resultTaskId,...metadata(nowUtc)});
    if (resultTaskId) await db.taskChanges.add({generationId,id:crypto.randomUUID(),taskId:resultTaskId,previousState:before,nextState:canonical(await db.taskOccurrences.where('generationId').equals(generationId).filter(t => t.cycleId === cycle.id).toArray()),sourceId,idempotencyKey:command.idempotencyKey,requestBody,occurredAt:nowUtc,...metadata(nowUtc)});
    return rule ? task ?? current : undefined;
  });
}

export function lastWatered(events: CareEventRecord[]): string | null {
  return effective(events).map(r => ({id:r.id,kind:'WATERED' as const,occurredAt:r.occurredAt})).sort(factOrder).at(-1)?.occurredAt ?? null;
}
export function visibleTask(task: TaskOccurrenceRecord, cycles: CycleRecord[]): boolean {
  return ['OPEN','SNOOZED'].includes(task.status) && cycles.some(c => c.id === task.cycleId && c.status === 'ACTIVE' && c.recordStatus === 'ACTIVE');
}
export function taskOrder(a: TaskOccurrenceRecord,b: TaskOccurrenceRecord): number {
  return b.priority-a.priority || compare(a.dueLocalDate,b.dueLocalDate) || compare(a.cycleId,b.cycleId) || compare(a.actionKind,b.actionKind) || a.occurrenceSeq-b.occurrenceSeq;
}
