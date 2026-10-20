import Dexie from 'dexie';
import { Blob as NodeBlob } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach,beforeEach,describe,it,expect,vi } from 'vitest';
import { SikmulwangDB,initializeDatabase } from '../lib/db/database';
import { SikmulwangDB as OldDB,initializeDatabase as initializeOld } from './fixtures/p2-9df3ef2/database';
import * as oldPlants from './fixtures/p2-9df3ef2/plantingRepository';
import { withWriteTransaction as oldWrite } from './fixtures/p2-9df3ef2/transaction';
import { createPlanting,purgePlanting } from '../lib/db/plantingRepository';
import { saveEntry,attachPhoto,setEntryTrash,setPhotoTrash,markPhotoRecovery } from '../lib/journal/repository';
import { stripPngMetadata,hashBlob,type ProcessedPhoto } from '../lib/journal/photo';
import { sha256 } from '../lib/care/engine';
import hashes from './fixtures/p2-9df3ef2/SHA256.json';
import sourceHashes from './fixtures/p2-9df3ef2/SOURCE_SHA256.json';
import frozen from './fixtures/p2-608da74-state.json';

const generation = 'g_default';
const blob = (value: Uint8Array | string,type='image/png') => new NodeBlob([value],{ type }) as unknown as Blob;
// Actual 1x1 PNG with critical chunks only, generated from a synthetic pixel.
const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==','base64'));
const photo = (): ProcessedPhoto => ({ state:'READY',display:blob(stripPngMetadata(png)),thumbnail:blob(stripPngMetadata(png)) });
let db: SikmulwangDB, old: OldDB;
beforeEach(() => { const name = `p3-${crypto.randomUUID()}`; db = new SikmulwangDB(name); old = new OldDB(name); });
afterEach(async () => { vi.restoreAllMocks(); old.close(); await db.delete(); });
async function state() {
  const result: Record<string,unknown[]> = {};
  for (const table of db.tables) result[table.name] = await table.toArray();
  result.mediaBlobs = await Promise.all((await db.mediaBlobs.toArray()).map(async row => ({ ...row,blob:Array.from(new Uint8Array(await row.blob.arrayBuffer())) })));
  return result;
}
async function seedOld() {
  await initializeOld(old);
  return oldPlants.createPlanting(old,1,generation,{ displayName:'P2 보존 식물',locationId:'loc_indoor_living',groupType:'INDIVIDUAL',quantity:1,startLocalDate:'2026-01-01' });
}
async function seed() {
  const meta = await initializeDatabase(db);
  const records = await createPlanting(db,meta.epoch,generation,{ displayName:'합성 식물',locationId:'loc_indoor_living',groupType:'INDIVIDUAL',quantity:1,startLocalDate:'2026-01-01' });
  const input = { id:'entry',expectedRevision:0,cycleId:records.cycle!.id,entryLocalDate:'2026-03-08',title:'어제 관찰',body:'새잎 기록',tags:['성장'],draftState:'DRAFT' as const,writeId:crypto.randomUUID() };
  return { ...records,meta,input };
}
describe('P3 actual P2 writer barrier',() => {
  it('frozen source manifest is unchanged',async () => {
    for (const [file,hash] of Object.entries(hashes)) {
      const source=readFileSync(resolve('src/test/fixtures/p2-9df3ef2',file),'utf8').replace(/\r\n/g,'\n');
      expect(await sha256(source)).toBe(hash);
      expect(await sha256(source.replaceAll('../../../lib/care/engine','../care/engine'))).toBe(sourceHashes[file as keyof typeof sourceHashes]);
    }
  });
  it('counterexample: actual P2 purge orphans a diary, demonstrating why meta2 is unsafe',async () => {
    const { planting,cycle } = await seedOld();
    await old.diaries.add({ generationId:generation,id:'legacy-example',cycleId:cycle!.id,entryLocalDate:'2026-03-08',timeZone:'Asia/Seoul',title:null,body:'synthetic',draftState:'DRAFT',revision:1 });
    await oldPlants.purgePlanting(old,1,generation,planting.id,1);
    expect(await old.plantings.count()).toBe(0); expect(await old.diaries.count()).toBe(1);
  });
  it('kept-open and reopened actual P2 initialization/purge/create/edit reject P3 metadata without writes',async () => {
    const { planting,cycle } = await seedOld(); const meta = await initializeDatabase(db);
    await saveEntry(db,meta.epoch,generation,{ id:'protected',expectedRevision:0,cycleId:cycle!.id,entryLocalDate:'2026-03-08',title:'',body:'journal only',tags:[],draftState:'DRAFT',writeId:'a' });
    const before = await state(); expect(old.isOpen()).toBe(true);
    for (const epoch of [1,meta.epoch]) await expect(oldPlants.purgePlanting(old,epoch,generation,planting.id,1)).rejects.toThrow('지원하지 않는 스키마');
    await expect(oldPlants.updatePlanting(old,1,generation,planting.id,{ displayName:'bad',expectedRevision:1 })).rejects.toThrow('지원하지 않는 스키마');
    await expect(oldPlants.createPlanting(old,1,generation,{ displayName:'bad',locationId:'loc_balcony',groupType:'INDIVIDUAL',quantity:1 })).rejects.toThrow('지원하지 않는 스키마');
    old.close(); old = new OldDB(db.name);
    await expect(initializeOld(old)).rejects.toThrow('지원하지 않는 스키마');
    await expect(oldPlants.purgePlanting(old,meta.epoch,generation,planting.id,1)).rejects.toThrow('지원하지 않는 스키마');
    expect(await state()).toEqual(before); expect(db.verno).toBe(1);
  });
  it('P2 write first is preserved, concurrent P3 initializers advance epoch once',async () => {
    const { planting } = await seedOld();
    let enter!:()=>void,release!:()=>void;
    const entered = new Promise<void>(r=>enter=r),gate = new Promise<void>(r=>release=r);
    const write = oldWrite(old,[old.plantings],1,generation,async()=> { enter(); await Dexie.waitFor(gate); await old.plantings.put({ ...planting,displayName:'before-transition',revision:2 }); });
    await entered; const transition = initializeDatabase(db); release(); await write;
    const other = new SikmulwangDB(db.name);
    try {
      const metas = await Promise.all([transition,initializeDatabase(other),initializeDatabase(db)]);
      expect(metas.every(m=>m.epoch===2 && m.schemaVersion===3)).toBe(true);
      expect((await db.plantings.toArray())[0].displayName).toBe('before-transition');
    } finally { other.close(); }
  });
  it('P3 transition first rejects queued P2 purge',async () => {
    const { planting } = await seedOld(); await db.open();
    let enter!:()=>void,release!:()=>void;
    const entered = new Promise<void>(r=>enter=r),gate = new Promise<void>(r=>release=r);
    const transition = db.transaction('rw',db.tables,async()=> { await initializeDatabase(db); enter(); await Dexie.waitFor(gate); });
    await entered;
    const rejection = expect(Dexie.ignoreTransaction(()=>oldPlants.purgePlanting(old,1,generation,planting.id,1))).rejects.toThrow('지원하지 않는 스키마');
    release(); await transition; await rejection; expect(await db.plantings.count()).toBe(1);
  });
  it('P2 purge before transition leaves no parent and P3 refuses orphan diary',async()=> {
    const { planting,cycle } = await seedOld(); await oldPlants.purgePlanting(old,1,generation,planting.id,1);
    const meta = await initializeDatabase(db); const before = await state();
    await expect(saveEntry(db,meta.epoch,generation,{ id:'orphan',cycleId:cycle!.id,expectedRevision:0,entryLocalDate:'2026-03-08',title:'',body:'',tags:[],draftState:'DRAFT',writeId:'a' })).rejects.toThrow('시즌');
    expect(await state()).toEqual(before);
  });
  it('mid-transition quota keeps ALL frozen stores and actual Blob bytes, old P2 works and retry succeeds',async()=> {
    await db.open();
    await db.transaction('rw',db.tables,async()=> {
      for (const [name,rows] of Object.entries(frozen.stores)) if(rows.length) await db.table(name).bulkAdd(rows);
      const bytes = blob('기존 원본 bytes','image/jpeg');
      await db.mediaBlobs.add({ generationId:generation,id:'existing',mediaId:'existing',variant:'ORIGINAL',blob:bytes,byteLength:bytes.size,sha256:'legacy' });
    });
    await initializeOld(old); const before = await state();
    const fault = (_:unknown,key:unknown)=> { if(key==='schemaVersion') throw new DOMException('injected quota','QuotaExceededError'); };
    db.meta.hook('updating',fault);
    await expect(initializeDatabase(db)).rejects.toThrow('quota'); expect(await state()).toEqual(before);
    expect((await initializeOld(old)).schemaVersion).toBe(2);
    db.meta.hook.updating.unsubscribe(fault);
    const meta = await initializeDatabase(db); expect(meta).toMatchObject({ schemaVersion:3,epoch:3 });
    const after = await state(); for(const name of Object.keys(before)) if(name!=='meta') expect(after[name]).toEqual(before[name]);
    await expect(initializeOld(old)).rejects.toThrow('지원하지 않는 스키마');
  });
});
describe('P3 journal/media preservation',()=> {
  it('date/DST and ended-season history retain entry date, createdAt, tags and no care tasks',async()=> {
    const { input,meta,cycle } = await seed();
    await db.cycles.update([generation,cycle!.id],{ timeZone:'America/New_York',status:'ENDED',endLocalDate:'2026-03-09' });
    const first = await saveEntry(db,meta.epoch,generation,input);
    const changed = await saveEntry(db,meta.epoch,generation,{ ...input,expectedRevision:1,writeId:'b',body:'편집됨',entryLocalDate:'2026-03-09',draftState:'PUBLISHED' });
    expect(changed).toMatchObject({ createdAt:first.createdAt,timeZone:'America/New_York',entryLocalDate:'2026-03-09',tags:['성장'],revision:2 });
    expect(await db.careEvents.count()).toBe(0); expect(await db.taskOccurrences.count()).toBe(0);
    await expect(saveEntry(db,meta.epoch,generation,{ ...input,expectedRevision:2,writeId:'c',entryLocalDate:'2026-03-10' })).rejects.toThrow('시즌 기간');
  });
  it('same request retry is idempotent, altered key rejected, concurrent revision loses no stored data',async()=> {
    const { input,meta } = await seed(); const first = await saveEntry(db,meta.epoch,generation,input);
    expect(await saveEntry(db,meta.epoch,generation,input)).toEqual(first);
    await expect(saveEntry(db,meta.epoch,generation,{ ...input,body:'changed' })).rejects.toThrow('동일 요청');
    const before = await state(); await expect(saveEntry(db,meta.epoch,generation,{ ...input,writeId:'b',body:'stale' })).rejects.toThrow('다른 탭'); expect(await state()).toEqual(before);
    const results = await Promise.allSettled(['one','two'].map(body=>saveEntry(db,meta.epoch,generation,{ ...input,expectedRevision:1,writeId:body,body })));
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1); expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
  });
  it('journal-only parent purge blocked for draft, trash and restored diary',async()=> {
    const { input,meta,planting } = await seed(); let diary = await saveEntry(db,meta.epoch,generation,input);
    for(const trashed of [true,false]) {
      diary = await setEntryTrash(db,meta.epoch,generation,diary.id,diary.revision,trashed);
      await expect(purgePlanting(db,meta.epoch,generation,planting.id,1)).rejects.toThrow('일기');
    }
  });
  it('shares identical bytes, preserves removed/trash/last references and restores attachment',async()=> {
    const { input,meta } = await seed(); let first = await saveEntry(db,meta.epoch,generation,input);
    first = await attachPhoto(db,meta.epoch,generation,first.id,first.revision,photo());
    expect(await attachPhoto(db,meta.epoch,generation,first.id,first.revision,photo())).toEqual(first);
    await expect(attachPhoto(db,meta.epoch,generation,first.id,1,photo())).rejects.toThrow('다른 탭');
    let second = await saveEntry(db,meta.epoch,generation,{ ...input,id:'second',writeId:'second' });
    second = await attachPhoto(db,meta.epoch,generation,second.id,second.revision,photo());
    expect(await db.media.count()).toBe(1); expect(await db.mediaBlobs.count()).toBe(2); expect(await db.mediaLinks.count()).toBe(2);
    const before = (await state()).mediaBlobs;
    const link = (await db.mediaLinks.toArray()).find(l=>l.ownerId===first.id)!;
    first = await setPhotoTrash(db,meta.epoch,generation,first.id,first.revision,link.id,true);
    await setEntryTrash(db,meta.epoch,generation,second.id,second.revision,true);
    expect((await state()).mediaBlobs).toEqual(before);
    first = await setPhotoTrash(db,meta.epoch,generation,first.id,first.revision,link.id,false);
    expect((await db.mediaLinks.get([generation,link.id]))?.recordStatus).toBe('ACTIVE');
    expect((await state()).mediaBlobs).toEqual(before);
    for(const b of await db.mediaBlobs.toArray()) { expect(await hashBlob(b.blob)).toBe(b.sha256); expect(b.blob.size).toBe(b.byteLength); }
  });
  for(const store of ['media','mediaBlobs','mediaLinks','diaries'] as const) it(`injected ${store} quota aborts whole photo transaction; text and ALL stores/bytes survive; same photo retries once`,async()=> {
    const { input,meta } = await seed(); const diary = await saveEntry(db,meta.epoch,generation,input);
    const before = await state();
    const fault = ()=> { throw new DOMException('injected quota','QuotaExceededError'); };
    const event = store==='diaries' ? 'updating' : 'creating';
    if (store === 'diaries') db.diaries.hook('updating',fault); else db[store].hook('creating',fault);
    await expect(attachPhoto(db,meta.epoch,generation,diary.id,diary.revision,photo())).rejects.toThrow('quota'); expect(await state()).toEqual(before);
    db[store].hook(event).unsubscribe(fault);
    const row = await attachPhoto(db,meta.epoch,generation,diary.id,diary.revision,photo()); expect(row.revision).toBe(2); expect(await db.media.count()).toBe(1);
  });
  for(const damage of ['crypto','cancel','epoch','generation','fence','R5','revision'] as const) it(`${damage} photo failure preserves ALL stores and bytes`,async()=> {
    const { input,meta } = await seed(); const diary = await saveEntry(db,meta.epoch,generation,input);
    const controller = new AbortController();
    if(damage==='crypto') vi.spyOn(crypto.subtle,'digest').mockRejectedValue(new Error('crypto unavailable'));
    if(damage==='cancel') controller.abort();
    if(damage==='epoch') await db.meta.update('epoch',{ value:meta.epoch+1 });
    if(damage==='generation') { await db.generationRegistry.add({ generationId:'next',profileId:'p_default',state:'ACTIVE',schemaVersion:1,createdAt:'now',updatedAt:'now' }); await db.meta.update('activeGenerationId',{ value:'next' }); }
    if(damage==='fence') await db.meta.update('writeFence',{ value:true });
    if(damage==='R5') await db.generationRegistry.delete(generation);
    const before = await state();
    await expect(attachPhoto(db,meta.epoch,generation,diary.id,damage==='revision'?99:diary.revision,photo(),controller.signal)).rejects.toThrow(); expect(await state()).toEqual(before);
  });
  it('rejects byte-corrupt shared Blob without replacing existing bytes',async()=> {
    const { input,meta } = await seed(); const diary = await saveEntry(db,meta.epoch,generation,input); await attachPhoto(db,meta.epoch,generation,diary.id,1,photo());
    const first = (await db.mediaBlobs.toArray())[0]; await db.mediaBlobs.update([generation,first.id],{ blob:blob('corrupted') });
    const second = await saveEntry(db,meta.epoch,generation,{ ...input,id:'second',writeId:'second' }); const before = await state();
    await expect(attachPhoto(db,meta.epoch,generation,second.id,second.revision,photo())).rejects.toThrow('bytes'); expect(await state()).toEqual(before);
  });
  it('PNG metadata allowlist removes location-bearing ancillary bytes',()=> {
    const payload = new TextEncoder().encode('GPSLatitude=37;GPSLongitude=127');
    const chunk = new Uint8Array(payload.length+12); new DataView(chunk.buffer).setUint32(0,payload.length); chunk.set(new TextEncoder().encode('eXIf'),4); chunk.set(payload,8);
    const withExif = new Uint8Array(png.length+chunk.length); withExif.set(png.slice(0,33)); withExif.set(chunk,33); withExif.set(png.slice(33),33+chunk.length);
    const output = stripPngMetadata(withExif); expect(output).toEqual(png); expect(new TextDecoder().decode(output)).not.toContain('GPS');
  });
});

describe('P3 adversarial recovery follow-up',()=> {
  it('cancel inside active link write aborts previously staged media/blob writes',async()=> {
    const { input,meta }=await seed();const diary=await saveEntry(db,meta.epoch,generation,input);const before=await state();const controller=new AbortController();
    const cancel=()=> { controller.abort(); };
    db.mediaLinks.hook('creating',cancel);
    await expect(attachPhoto(db,meta.epoch,generation,diary.id,diary.revision,photo(),controller.signal)).rejects.toThrow();
    expect(await state()).toEqual(before);db.mediaLinks.hook.creating.unsubscribe(cancel);
    await attachPhoto(db,meta.epoch,generation,diary.id,diary.revision,photo());expect(await db.media.count()).toBe(1);
  });
  it('text quota preserves entire prior state and exact request retry creates one revision',async()=> {
    const { input,meta }=await seed();const first=await saveEntry(db,meta.epoch,generation,input);const before=await state();
    const next={ ...input,expectedRevision:first.revision,body:'retry retained text',writeId:'retry-text' };
    const fail=()=> { throw new DOMException('text quota','QuotaExceededError'); };db.diaries.hook('updating',fail);
    await expect(saveEntry(db,meta.epoch,generation,next)).rejects.toThrow('quota');expect(await state()).toEqual(before);db.diaries.hook.updating.unsubscribe(fail);
    const row=await saveEntry(db,meta.epoch,generation,next);expect(await saveEntry(db,meta.epoch,generation,next)).toEqual(row);expect(row.revision).toBe(2);
  });
  it('stale same-photo attachment cannot adopt another tabs newer revision and overwrite text',async()=> {
    const { input,meta }=await seed();const original=await saveEntry(db,meta.epoch,generation,input);
    let current=await saveEntry(db,meta.epoch,generation,{ ...input,expectedRevision:1,body:'A committed text',writeId:'A' });
    current=await attachPhoto(db,meta.epoch,generation,current.id,current.revision,photo());const before=await state();
    await expect(attachPhoto(db,meta.epoch,generation,original.id,original.revision,photo())).rejects.toThrow('다른 탭');expect(await state()).toEqual(before);
    await expect(saveEntry(db,meta.epoch,generation,{ ...input,expectedRevision:original.revision,title:'B stale title',writeId:'B' })).rejects.toThrow('다른 탭');expect((await db.diaries.get([generation,current.id]))?.body).toBe('A committed text');
  });
});


describe('durable photo recovery marker',()=> {
  it('survives failed work/reentry and clears atomically with new or duplicate attachment',async()=> {
    const { input,meta }=await seed();let diary=await saveEntry(db,meta.epoch,generation,input);
    diary=await markPhotoRecovery(db,meta.epoch,generation,diary.id,diary.revision,true);
    expect((await db.diaries.get([generation,diary.id]))).toMatchObject({ body:input.body,photoRecovery:'RESELECT_REQUIRED' });
    diary=await attachPhoto(db,meta.epoch,generation,diary.id,diary.revision,photo());expect(diary.photoRecovery).toBeNull();
    diary=await markPhotoRecovery(db,meta.epoch,generation,diary.id,diary.revision,true);
    diary=await attachPhoto(db,meta.epoch,generation,diary.id,diary.revision,photo());expect(diary.photoRecovery).toBeNull();expect(await db.media.count()).toBe(1);expect(await db.mediaLinks.count()).toBe(1);
  });
});
