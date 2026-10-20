import { Blob as NodeBlob } from 'node:buffer';
import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
import { BlobReader,BlobWriter,ZipReader,ZipWriter } from '@zip.js/zip.js';
import { SikmulwangDB,initializeDatabase } from '../lib/db/database';
import { createPlanting,updatePlanting } from '../lib/db/plantingRepository';
import { executeCare,lastWatered } from '../lib/care/repository';
import { saveEntry,attachPhoto,setEntryTrash,setPhotoTrash } from '../lib/journal/repository';
import { exportBackup,stageBackup,activateBackup,activateArchived,listBackupJobs,cancelBackup,sealBackup } from '../lib/backup/repository';
import { readArchive,createArchive } from '../lib/backup/archive';
import { STORES,validateDataset,hashBlob,type Dataset } from '../lib/backup/model';
import { canonical,sha256 } from '../lib/care/engine';
const generation='g_default';let db:SikmulwangDB;
const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==','base64'));
beforeEach(async()=>{vi.stubGlobal('Blob',NodeBlob);db=new SikmulwangDB(`backup-${crypto.randomUUID()}`);await initializeDatabase(db);});
afterEach(async()=>{vi.restoreAllMocks();vi.unstubAllGlobals();await db.delete();});
async function seed(){
  const {planting,cycle}=await createPlanting(db,1,generation,{displayName:'합성 백업 식물',locationId:'loc_indoor_living',groupType:'INDIVIDUAL',quantity:1,startLocalDate:'2026-01-01'});
  await executeCare(db,1,generation,{cycleId:cycle!.id,kind:'RULE',inspectionDays:5,expectedRevision:1,occurredAt:'2026-10-19T00:00:00.000Z',idempotencyKey:'rule'});
  const task=(await db.taskOccurrences.toArray())[0];await executeCare(db,1,generation,{cycleId:cycle!.id,taskId:task.id,kind:'WATERED',expectedRevision:task.revision,occurredAt:'2026-10-19T00:00:00.000Z',idempotencyKey:'water'});
  let diary=await saveEntry(db,1,generation,{id:'diary',cycleId:cycle!.id,entryLocalDate:'2026-10-18',title:'과거 일기',body:'보존할 본문',tags:['성장'],draftState:'DRAFT',expectedRevision:0,writeId:'diary'});
  const blob=new Blob([png],{type:'image/png'});diary=await attachPhoto(db,1,generation,diary.id,diary.revision,{state:'READY',display:blob,thumbnail:blob});
  const link=(await db.mediaLinks.toArray())[0];diary=await setPhotoTrash(db,1,generation,diary.id,diary.revision,link.id,true);await setEntryTrash(db,1,generation,diary.id,diary.revision,true);
  return {planting,cycle};
}
async function snapshot(gen=generation){const data:Record<string,unknown>={};for(const name of STORES){const rows=await db.table(name).where('generationId').equals(gen).toArray();data[name]=name==='mediaBlobs'?await Promise.all(rows.map(async r=>({...r,blob:Array.from(new Uint8Array(await r.blob.arrayBuffer()))}))):rows;}return data;}
async function rewrite(blob:Blob,mutate:(files:Map<string,Blob>)=>Promise<void>|void){const reader=new ZipReader(new BlobReader(blob),{useWebWorkers:false});const files=new Map<string,Blob>();for(const e of await reader.getEntries())if(!e.directory)files.set(e.filename,await e.getData(new BlobWriter(),{useWebWorkers:false}));await reader.close();await mutate(files);const out=new BlobWriter();const writer=new ZipWriter(out,{level:0,useWebWorkers:false});for(const [path,bytes]of files)await writer.add(path,new BlobReader(bytes));return writer.close();}
async function consistentMutation(blob:Blob,name:string,change:(data:unknown[])=>void){return rewrite(blob,async files=>{const manifest=JSON.parse(await files.get('manifest.json')!.text());const rows=JSON.parse(await files.get(name)!.text());change(rows);const text=canonical(rows);files.set(name,new Blob([text]));const f=manifest.fileEntries.find((f:{path:string})=>f.path===name);f.bytes=new TextEncoder().encode(text).length;f.sha256=await sha256(text);const {snapshotDigest:_hash,complete:_complete,...body}=manifest;void _hash;void _complete;manifest.snapshotDigest=await sha256(canonical(body));files.set('manifest.json',new Blob([canonical(manifest)]));});}

describe('P4 complete ZIP and original preserving restore',()=>{
  it('round-trips records/dates/digests/trash/shared bytes, activates atomically, rejects stale writer, reopens archive',async()=>{
    await seed();const before=await snapshot();const oldProfiles=await db.profiles.toArray();const oldLast=lastWatered(await db.careEvents.toArray());
    const exported=await exportBackup(db,{epoch:1,generation});const archive=await readArchive(exported.blob);expect(archive.manifest.entityCounts.diaries).toBe(1);expect(archive.manifest.entityCounts.mediaBlobs).toBe(2);
    expect((await db.meta.get('writeFence'))?.value).toBe(false);
    const restore=await stageBackup(db,{epoch:1,generation},exported.blob);expect(restore.state).toBe('READY');expect(await snapshot()).toEqual(before);expect((await db.meta.get('activeGenerationId'))?.value).toBe(generation);
    await activateBackup(db,restore.id);const active=(await initializeDatabase(db));expect(active.epoch).toBe(2);expect(active.activeGenerationId).toBe(restore.generationId);
    const imported=await snapshot(restore.generationId);for(const name of STORES)expect((imported[name] as Record<string,unknown>[]).map(r=>({...r,generationId:generation}))).toEqual(before[name]);
    expect(await db.profiles.get(oldProfiles[0].profileId)).toEqual(oldProfiles[0]);expect(await snapshot()).toEqual(before);expect(lastWatered(await db.careEvents.where('generationId').equals(active.activeGenerationId).toArray())).toBe(oldLast);
    await expect(createPlanting(db,1,generation,{displayName:'stale',locationId:'loc_balcony',groupType:'INDIVIDUAL',quantity:1})).rejects.toThrow('세션');
    await activateArchived(db,{epoch:2,generation:active.activeGenerationId},generation);expect((await initializeDatabase(db)).activeGenerationId).toBe(generation);expect(await snapshot()).toEqual(before);
  });
  it('restore → new care write → export → restore preserves historical snapshot strings and retry semantics',async()=>{
    const {cycle}=await seed();const backup=await exportBackup(db,{epoch:1,generation});const first=await stageBackup(db,{epoch:1,generation},backup.blob);await activateBackup(db,first.id);
    const active=(await initializeDatabase(db));const task=(await db.taskOccurrences.where('generationId').equals(active.activeGenerationId).toArray()).find(t=>t.status==='OPEN')!;
    await executeCare(db,active.epoch,active.activeGenerationId,{cycleId:cycle!.id,taskId:task.id,kind:'MOIST',expectedRevision:task.revision,occurredAt:'2026-10-20T00:00:00.000Z',idempotencyKey:'after-restore'});
    const logs=await db.decisionLogs.where('generationId').equals(active.activeGenerationId).toArray();expect(new Set(logs.map(l=>JSON.parse(l.inputSnapshot).generationId)).size).toBe(2);
    const next=await exportBackup(db,{epoch:active.epoch,generation:active.activeGenerationId});const second=await stageBackup(db,{epoch:active.epoch,generation:active.activeGenerationId},next.blob);await activateBackup(db,second.id);
    expect((await db.decisionLogs.where('generationId').equals(second.generationId!).toArray()).map(r=>r.inputSnapshot)).toEqual(logs.map(r=>r.inputSnapshot));
  });
  it('duplicate backup warns without overwriting any existing records',async()=>{await seed();const zip=await exportBackup(db,{epoch:1,generation});await stageBackup(db,{epoch:1,generation},zip.blob);const before=await snapshot();await expect(stageBackup(db,{epoch:1,generation},zip.blob)).rejects.toThrow('이미 가져온');expect(await snapshot()).toEqual(before);});
  for(const key of ['mediaBlobs','diaries','decisionLogs']as const)it(`staging ${key} quota preserves original full dataset, retry adds fresh namespace`,async()=>{
    await seed();const zip=await exportBackup(db,{epoch:1,generation});const before=await snapshot();const fault=()=>{throw new DOMException('injected quota','QuotaExceededError');};db[key].hook('creating',fault);
    await expect(stageBackup(db,{epoch:1,generation},zip.blob)).rejects.toThrow('quota');expect(await snapshot()).toEqual(before);expect((await initializeDatabase(db)).activeGenerationId).toBe(generation);db[key].hook.creating.unsubscribe(fault);
    const retry=await stageBackup(db,{epoch:1,generation},zip.blob);expect(retry.state).toBe('READY');expect(await snapshot()).toEqual(before);
  });
  it('promotion epoch write quota rolls all pointer/state changes back and retry succeeds',async()=>{await seed();const zip=await exportBackup(db,{epoch:1,generation});const restore=await stageBackup(db,{epoch:1,generation},zip.blob);const before=await snapshot();const fault=(_:unknown,key:unknown)=>{if(key==='epoch')throw new DOMException('promotion quota','QuotaExceededError');};db.meta.hook('updating',fault);await expect(activateBackup(db,restore.id)).rejects.toThrow('quota');expect((await initializeDatabase(db)).activeGenerationId).toBe(generation);expect((await db.generationRegistry.get(restore.generationId!))?.state).toBe('STAGING');expect(await snapshot()).toEqual(before);db.meta.hook.updating.unsubscribe(fault);await activateBackup(db,restore.id);expect((await initializeDatabase(db)).epoch).toBe(2);});
  it('ready staging survives connection close, revalidation rejects corrupted staged row',async()=>{await seed();const zip=await exportBackup(db,{epoch:1,generation});const restore=await stageBackup(db,{epoch:1,generation},zip.blob);const name=db.name;db.close();db=new SikmulwangDB(name);await initializeDatabase(db);await db.diaries.update([restore.generationId!,'diary'],{body:'tampered'});await expect(activateBackup(db,restore.id)).rejects.toThrow('변경');expect((await initializeDatabase(db)).activeGenerationId).toBe(generation);});
  it('cancelled ready staging never activates, source remains writable and full bytes intact',async()=>{const {planting}=await seed();const zip=await exportBackup(db,{epoch:1,generation});const restore=await stageBackup(db,{epoch:1,generation},zip.blob);const before=await snapshot();await cancelBackup(db,restore.id);await expect(activateBackup(db,restore.id)).rejects.toThrow();expect(await snapshot()).toEqual(before);await updatePlanting(db,1,generation,planting.id,{expectedRevision:1,displayName:'still writable'});});
  it('crypto failure clears only owned export fence and retains every original domain/blob',async()=>{await seed();const before=await snapshot();vi.spyOn(crypto.subtle,'digest').mockRejectedValue(new Error('injected crypto'));await expect(exportBackup(db,{epoch:1,generation})).rejects.toThrow('crypto');expect(await snapshot()).toEqual(before);expect((await db.meta.get('writeFence'))?.value).toBe(false);expect((await listBackupJobs(db))[0].state).toBe('FAILED');});
});
describe('P4 hostile archive precheck without DB writes',()=>{
  for(const path of ['../escape','/absolute','data\\escape.json','data/unknown.json'])it(`rejects ${path}`,async()=>{const zip=await exportBackup(db,{epoch:1,generation});const bad=await rewrite(zip.blob,files=>{files.set(path,new Blob(['bad']));});const before=await db.meta.toArray();await expect(stageBackup(db,{epoch:1,generation},bad)).rejects.toThrow();expect(await db.meta.toArray()).toEqual(before);});
  for(const field of ['formatVersion','schemaVersion','writerCompatibility','algorithmVersion'])it(`rejects future ${field}`,async()=>{const zip=await exportBackup(db,{epoch:1,generation});const bad=await rewrite(zip.blob,async files=>{const m=JSON.parse(await files.get('manifest.json')!.text());m[field]=999;files.set('manifest.json',new Blob([JSON.stringify(m)]));});const before=await db.meta.toArray();await expect(stageBackup(db,{epoch:1,generation},bad)).rejects.toThrow('미지원');expect(await db.meta.toArray()).toEqual(before);});
  for(const damage of ['fk','date','enum','missing-common','digest']as const)it(`consistent hash rewrite still rejects ${damage}`,async()=>{await seed();const zip=await exportBackup(db,{epoch:1,generation});const path=damage==='digest'?'data/decision-logs.json':'data/cycles.json';const bad=await consistentMutation(zip.blob,path,rows=>{const row=rows[0]as Record<string,unknown>;if(damage==='fk')row.plantingId='missing';if(damage==='date')row.startLocalDate='2026-02-30';if(damage==='enum')row.status='UNKNOWN';if(damage==='missing-common')delete row.revision;if(damage==='digest')row.inputSnapshot='{}';});const before=await snapshot(),metadata=await db.meta.toArray();await expect(stageBackup(db,{epoch:1,generation},bad)).rejects.toThrow();expect(await snapshot()).toEqual(before);expect(await db.meta.toArray()).toEqual(metadata);});
  for(const size of [500*1024*1024,2*1024*1024*1024])it(`rejects ${size} input before reading bytes`,async()=>{const fake={size,arrayBuffer:vi.fn(),slice:vi.fn()} as unknown as Blob;await expect(readArchive(fake)).rejects.toThrow('크기');expect(fake.slice).not.toHaveBeenCalled();});
  it('cancelled signal rejects export without acquiring fence or job',async()=>{const c=new AbortController();c.abort();const before=await db.meta.toArray();await expect(exportBackup(db,{epoch:1,generation},c.signal)).rejects.toThrow();expect(await db.meta.toArray()).toEqual(before);});
  it('unknown foreign fence is never automatically released',async()=>{await db.meta.update('writeFence',{value:true});await expect(exportBackup(db,{epoch:1,generation})).rejects.toThrow();expect((await db.meta.get('writeFence'))?.value).toBe(true);});
});



describe('P4 review counterexamples and interruption races',()=>{
  for(const damage of ['observation-value','multiple-open','unsupported-action']as const)it('rejects '+damage+' even with consistently rewritten file/manifest hashes',async()=>{
    const {cycle}=await seed();if(damage==='observation-value'){const task=(await db.taskOccurrences.toArray()).find(t=>t.status==='OPEN')!;await executeCare(db,1,generation,{cycleId:cycle!.id,taskId:task.id,kind:'MOIST',expectedRevision:task.revision,occurredAt:'2026-10-20T00:00:00.000Z',idempotencyKey:'moist'});}
    const zip=await exportBackup(db,{epoch:1,generation});const path=damage==='observation-value'?'data/observations.json':damage==='multiple-open'?'data/task-occurrences.json':'data/care-events.json';
    const bad=await consistentMutation(zip.blob,path,rows=>{const row=rows[0]as Record<string,unknown>;if(damage==='observation-value')row.value='DRY';if(damage==='unsupported-action')row.actionKind='FERTILIZED';if(damage==='multiple-open'){row.status='OPEN';row.resolutionId=null;row.resolutionType=null;}});
    const before=await snapshot();await expect(stageBackup(db,{epoch:1,generation},bad)).rejects.toThrow();expect(await snapshot()).toEqual(before);
  });
  it('cancel while export hashes clears its owned fence, late completion cannot deliver a successful file',async()=>{
    await seed();const original=crypto.subtle.digest.bind(crypto.subtle);let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>enter=r),gate=new Promise<void>(r=>release=r);
    vi.spyOn(crypto.subtle,'digest').mockImplementationOnce(async(...args)=>{enter();await gate;return original(...args);});
    const exporting=exportBackup(db,{epoch:1,generation});const rejection=exporting.then(()=>null,error=>error);await entered;
    await expect(createPlanting(db,1,generation,{displayName:'blocked',locationId:'loc_balcony',groupType:'INDIVIDUAL',quantity:1})).rejects.toThrow('차단');
    const pending=(await listBackupJobs(db)).find(j=>j.state==='EXPORTING')!;await cancelBackup(db,pending.id);release();expect(await rejection).toBeInstanceOf(Error);expect((await listBackupJobs(db)).find(j=>j.id===pending.id)?.state).toBe('CANCELLED');expect((await db.meta.get('writeFence'))?.value).toBe(false);
  });
  it('interrupted SEALING can revalidate and activate after reentry',async()=>{await seed();const zip=await exportBackup(db,{epoch:1,generation});const ready=await stageBackup(db,{epoch:1,generation},zip.blob);vi.spyOn(crypto.subtle,'digest').mockRejectedValueOnce(new Error('interrupted verification'));await expect(activateBackup(db,ready.id)).rejects.toThrow('interrupted');expect((await listBackupJobs(db)).find(j=>j.id===ready.id)?.state).toBe('SEALING');const checked=await sealBackup(db,ready.id);expect(checked.state).toBe('READY');await activateBackup(db,ready.id);expect((await initializeDatabase(db)).activeGenerationId).toBe(ready.generationId);});
  it('cancel inside promotion transaction rolls pointer/archive writes back',async()=>{await seed();const zip=await exportBackup(db,{epoch:1,generation});const ready=await stageBackup(db,{epoch:1,generation},zip.blob);const controller=new AbortController();const cancel=(_:unknown,key:unknown)=>{if(key==='epoch')controller.abort();};db.meta.hook('updating',cancel);await expect(activateBackup(db,ready.id,controller.signal)).rejects.toThrow();db.meta.hook.updating.unsubscribe(cancel);expect((await initializeDatabase(db)).activeGenerationId).toBe(generation);expect((await db.generationRegistry.get(generation))?.state).toBe('ACTIVE');});
  it('aborted archived return never changes active pointers',async()=>{await seed();const zip=await exportBackup(db,{epoch:1,generation});const ready=await stageBackup(db,{epoch:1,generation},zip.blob);await activateBackup(db,ready.id);const controller=new AbortController();controller.abort();await expect(activateArchived(db,{epoch:2,generation:ready.generationId!},generation,controller.signal)).rejects.toThrow();expect((await initializeDatabase(db)).activeGenerationId).toBe(ready.generationId);});
});
describe('P4 bounded synthetic scale',()=>{
  async function mediaDataset(count:number,bytes=png):Promise<Dataset>{
    const baseline=await readArchive((await exportBackup(db,{epoch:1,generation})).blob);const data=baseline.data;const blob=new Blob([bytes],{type:'image/png'}),hash=await hashBlob(blob),now=new Date().toISOString();
    data.stores.media=[];data.stores.mediaBlobs=[];data.blobs.clear();
    for(let i=0;i<count;i++){const id='m-'+i;data.stores.media.push({generationId:generation,id,mimeType:'image/png',byteLength:blob.size,sha256:hash,capturedAt:null,capturedLocalDate:null,privacyState:'ORIGINAL_PRESERVED',variants:['ORIGINAL'],createdAt:now,updatedAt:now});const b={generationId:generation,id:id+'-original',mediaId:id,variant:'ORIGINAL',byteLength:blob.size,sha256:hash};data.stores.mediaBlobs.push(b);data.blobs.set(b.id,blob);}
    return data;
  }
  for(const count of [1,100,1000,10000])it('preserves '+count+' small synthetic photo payloads and references',async()=>{const data=await mediaDataset(count);await validateDataset(data);const archive=await createArchive(data);const recovered=await readArchive(archive.blob);expect(recovered.data.stores.media).toEqual([...data.stores.media].sort((a,b)=>a.id<b.id?-1:1));expect(recovered.data.stores.mediaBlobs).toEqual([...data.stores.mediaBlobs].sort((a,b)=>a.id<b.id?-1:1));expect(recovered.data.blobs.size).toBe(count);},120000);
  it('round-trips 50MiB synthetic payloads one 25MiB Blob at a time, not a real-device performance claim',async()=>{const bytes=new Uint8Array(25*1024*1024);bytes.set(png);const data=await mediaDataset(2,bytes);const archive=await createArchive(data);const restored=await readArchive(archive.blob);expect([...restored.data.blobs.values()].reduce((n,b)=>n+b.size,0)).toBe(50*1024*1024);expect(await hashBlob(restored.data.blobs.values().next().value!)).toBe(await hashBlob(data.blobs.values().next().value!));},120000);
});

describe('P4 hostile ZIP structure and conflicting operations',()=>{
  for(const kind of ['symlink','encrypted','ratio','duplicate','central-directory','missing-file','blob-corrupt']as const)it('rejects '+kind+' before database writes',async()=>{
    let bad:Blob;
    if(kind==='symlink'||kind==='encrypted'||kind==='ratio'){
      const writer=new ZipWriter(new BlobWriter(),{useWebWorkers:false});const bytes=kind==='ratio'?new Uint8Array(1024*1024):new Uint8Array([1]);
      await writer.add('manifest.json',new BlobReader(new Blob([bytes])),kind==='symlink'?{msDosCompatible:false,unixMode:0xa1ff}:kind==='encrypted'?{password:'synthetic-only',zipCrypto:true}:{level:9});bad=await writer.close();
    }else{
      await seed();const zip=await exportBackup(db,{epoch:1,generation});
      if(kind==='missing-file')bad=await rewrite(zip.blob,files=>{files.delete('data/diaries.json');});
      else if(kind==='blob-corrupt')bad=await rewrite(zip.blob,files=>{const path=[...files.keys()].find(p=>p.startsWith('media/'))!;files.set(path,new Blob(['corrupt']));});
      else if(kind==='duplicate'){const zip2=await rewrite(zip.blob,files=>{files.set('data/profilez.json',new Blob(['[]']));});const bytes=new Uint8Array(await zip2.arrayBuffer());const needle=new TextEncoder().encode('data/profilez.json');for(let i=0;i<=bytes.length-needle.length;i++)if(needle.every((v,j)=>bytes[i+j]===v))bytes.set(new TextEncoder().encode('data/profiles.json'),i);bad=new Blob([bytes]);}
      else{const bytes=new Uint8Array(await zip.blob.arrayBuffer());const view=new DataView(bytes.buffer);view.setUint32(bytes.length-22+12,9*1024*1024,true);bad=new Blob([bytes]);}
    }
    const before=await snapshot(),meta=await db.meta.toArray();await expect(stageBackup(db,{epoch:1,generation},bad)).rejects.toThrow();expect(await snapshot()).toEqual(before);expect(await db.meta.toArray()).toEqual(meta);
  });
  it('two simultaneous imports admit one same-backup job and two promotions never double activate',async()=>{await seed();const zip=await exportBackup(db,{epoch:1,generation});const stages=await Promise.allSettled([stageBackup(db,{epoch:1,generation},zip.blob),stageBackup(db,{epoch:1,generation},zip.blob)]);expect(stages.filter(r=>r.status==='fulfilled')).toHaveLength(1);const ready=(stages.find(r=>r.status==='fulfilled')as PromiseFulfilledResult<Awaited<ReturnType<typeof stageBackup>>>).value;const acts=await Promise.allSettled([activateBackup(db,ready.id),activateBackup(db,ready.id)]);expect(acts.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect((await initializeDatabase(db)).epoch).toBe(2);});
});

describe('P4 legacy ownership and historical corrections',()=>{
  it('export excludes private ownership extras but returning to the original archive preserves those exact fields',async()=>{
    await seed();await db.table('profiles').update('p_default',{localOnlyNote:'synthetic retained note',oauthToken:'synthetic secret not exported'});await db.table('generationRegistry').update(generation,{localOnlyExtension:'retain me'});
    const zip=await exportBackup(db,{epoch:1,generation});const archive=await readArchive(zip.blob);expect(Object.keys(archive.data.profile)).not.toContain('oauthToken');expect(Object.keys(archive.data.generation)).not.toContain('localOnlyExtension');
    const ready=await stageBackup(db,{epoch:1,generation},zip.blob);await activateBackup(db,ready.id);await activateArchived(db,{epoch:2,generation:ready.generationId!},generation);
    expect(await db.table('profiles').get('p_default')).toMatchObject({localOnlyNote:'synthetic retained note',oauthToken:'synthetic secret not exported'});expect(await db.table('generationRegistry').get(generation)).toMatchObject({localOnlyExtension:'retain me'});
  });
  it('undo chain, historical input bytes and repeated undo idempotency survive restoration',async()=>{
    const {cycle}=await seed();const resolved=(await db.taskOccurrences.toArray()).find(t=>t.status==='RESOLVED')!,event=(await db.careEvents.toArray())[0];
    const undo={cycleId:cycle!.id,taskId:resolved.id,kind:'UNDO' as const,expectedRevision:resolved.revision,occurredAt:'2026-10-20T00:00:00.000Z',idempotencyKey:'undo-original',targetId:event.id,targetType:'CARE_EVENT' as const};
    await executeCare(db,1,generation,undo);expect(lastWatered(await db.careEvents.toArray())).toBeNull();const original=await snapshot();const zip=await exportBackup(db,{epoch:1,generation});const ready=await stageBackup(db,{epoch:1,generation},zip.blob);await activateBackup(db,ready.id);
    await executeCare(db,2,ready.generationId!,undo);const events=await db.careEvents.where('generationId').equals(ready.generationId!).toArray();expect(events.map(r=>({...r,generationId:generation}))).toEqual(original.careEvents);expect(lastWatered(events)).toBeNull();
  });
});
