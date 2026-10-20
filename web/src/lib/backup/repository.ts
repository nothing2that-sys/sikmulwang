import Dexie from 'dexie';
import type { SikmulwangDB } from '../db/database';
import { getSystemMeta, type SystemMetaState } from '../db/profileRepository';
import { StaleSessionError, WriteFenceActiveError } from '../db/errors';
import { STORES, fail, fingerprint, validateDataset, type Dataset, type Row, type Store } from './model';
import { createArchive, readArchive } from './archive';
export interface Session { epoch:number; generation:string }
export interface BackupJob {
  id:string; kind:'EXPORT'|'RESTORE';state:'EXPORTING'|'EXPORT_CREATED'|'STAGING'|'SEALING'|'READY'|'ACTIVE'|'FAILED'|'CANCELLED';
  source:Session;sourceProfileId:string;createdAt:string;updatedAt:string;
  profileId?:string;generationId?:string;backupId?:string;digest?:string;seal?:string;contentRevision:number;progress:number;counts?:Record<Store,number>;
}
function abortable(signal?:AbortSignal){signal?.throwIfAborted();const tx=Dexie.currentTransaction!;const abort=()=>tx.abort();const clean=()=>signal?.removeEventListener('abort',abort);signal?.addEventListener('abort',abort,{once:true});tx.on('complete',clean);tx.on('abort',clean);}
const jobKey=(id:string)=>`backupJob:${id}`;
async function job(db:SikmulwangDB,id:string):Promise<BackupJob> {const row=await db.meta.get(jobKey(id));if(!row)fail('백업 작업을 찾을 수 없어요.');return row!.value as BackupJob;}
async function putJob(db:SikmulwangDB,value:BackupJob){await db.meta.put({key:jobKey(value.id),value:{...value,updatedAt:new Date().toISOString()},updatedAt:new Date().toISOString()});}
async function session(db:SikmulwangDB,expected:Session,allowFence=false):Promise<SystemMetaState>{
  const meta=await getSystemMeta(db);const profile=await db.profiles.get(meta.activeProfileId);
  if(profile?.currentGenerationId!==meta.activeGenerationId)fail('프로필의 활성 세대 포인터가 손상됐어요.');
  if(meta.epoch!==expected.epoch||meta.activeGenerationId!==expected.generation)throw new StaleSessionError('다른 탭에서 정원이 전환됐어요. 새로고침 후 다시 시도해 주세요.');
  if(meta.writeFence&&!allowFence)throw new WriteFenceActiveError();return meta;
}
async function readDataset(db:SikmulwangDB,generationId:string):Promise<Dataset>{
  const generation=await db.generationRegistry.get(generationId);if(!generation)fail();const profile=await db.profiles.get(generation!.profileId);if(!profile)fail();
  const stores={} as Record<Store,Row[]>;const blobs=new Map<string,Blob>();
  for(const name of STORES){const rows=await db.table(name).where('generationId').equals(generationId).toArray() as Row[];stores[name]=name==='mediaBlobs'?rows.map(r=>{const {blob,...metadata}=r;blobs.set(r.id,blob as Blob);return metadata as Row;}):rows;}
  return {profile:{profileId:profile!.profileId,name:profile!.name,currentGenerationId:profile!.currentGenerationId,createdAt:profile!.createdAt,updatedAt:profile!.updatedAt},generation:{generationId:generation!.generationId,profileId:generation!.profileId,state:generation!.state,schemaVersion:generation!.schemaVersion,createdAt:generation!.createdAt,updatedAt:generation!.updatedAt},stores,blobs};
}
export async function listBackupJobs(db:SikmulwangDB):Promise<BackupJob[]>{return (await db.meta.toArray()).filter(r=>r.key.startsWith('backupJob:')).map(r=>r.value as BackupJob).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
export async function exportBackup(db:SikmulwangDB,expected:Session,signal?:AbortSignal):Promise<{blob:Blob;backupId:string}> {
  const id=crypto.randomUUID(),now=new Date().toISOString();
  await db.transaction('rw',[db.meta,db.profiles,db.generationRegistry],async()=>{
    abortable(signal);const meta=await session(db,expected);if((await db.meta.get('backupLock'))?.value)fail('다른 백업 작업이 진행 중이에요.');
    await putJob(db,{id,kind:'EXPORT',state:'EXPORTING',source:expected,sourceProfileId:meta.activeProfileId,createdAt:now,updatedAt:now,progress:0,contentRevision:0});
    await db.meta.put({key:'backupLock',value:id,updatedAt:now});await db.meta.put({key:'writeFence',value:true,updatedAt:now});
  });
  try {
    const snapshot=await db.transaction('r',db.tables,async()=>{await session(db,expected,true);if((await db.meta.get('backupLock'))?.value!==id||(await job(db,id)).state!=='EXPORTING')fail('취소되거나 교체된 백업입니다.');return readDataset(db,expected.generation);});
    const result=await createArchive(snapshot,signal);const checked=await readArchive(result.blob,signal);
    if(await fingerprint(checked.data)!==await fingerprint(snapshot))fail('백업 재읽기 동등성 검증에 실패했어요.');
    await db.transaction('rw',[db.meta,db.profiles,db.generationRegistry],async()=>{
      abortable(signal);await session(db,expected,true);const current=await job(db,id);
      if(current.state!=='EXPORTING'||(await db.meta.get('backupLock'))?.value!==id)fail('중단된 백업은 완료로 표시하지 않아요.');
      await putJob(db,{...current,state:'EXPORT_CREATED',backupId:result.manifest.backupId,digest:result.manifest.snapshotDigest,progress:1});
      await db.meta.delete('backupLock');await db.meta.put({key:'writeFence',value:false,updatedAt:new Date().toISOString()});
    });
    return {blob:result.blob,backupId:result.manifest.backupId};
  }catch(error){await cancelBackup(db,id,!signal?.aborted).catch(()=>{});throw error;}
}
export async function cancelBackup(db:SikmulwangDB,id:string,failed=false){
  await db.transaction('rw',[db.meta,db.profiles,db.generationRegistry],async()=>{
    const current=await job(db,id);if(['ACTIVE','EXPORT_CREATED','CANCELLED','FAILED'].includes(current.state))return;
    await getSystemMeta(db);
    if(current.kind==='EXPORT'){
      await session(db,current.source,true);
      if((await db.meta.get('backupLock'))?.value!==id)fail('다른 작업의 쓰기 잠금은 해제할 수 없어요.');
      await db.meta.delete('backupLock');await db.meta.put({key:'writeFence',value:false,updatedAt:new Date().toISOString()});
    }else {const gen=await db.generationRegistry.get(current.generationId!);if(gen?.state==='STAGING')await db.generationRegistry.put({...gen!,state:'ABORTED'});}
    await putJob(db,{...current,state:failed?'FAILED':'CANCELLED'});
  });
}
export async function stageBackup(db:SikmulwangDB,expected:Session,blob:Blob,signal?:AbortSignal):Promise<BackupJob>{
  // No writes before the complete, bounded archive and domain validation succeeds.
  const archive=await readArchive(blob,signal);const id=crypto.randomUUID(),profileId=`p_restore_${crypto.randomUUID()}`,generationId=`g_restore_${crypto.randomUUID()}`,now=new Date().toISOString();
  const profile={...archive.data.profile,profileId,currentGenerationId:generationId,name:`${archive.data.profile.name} (복원)`};
  const generation={...archive.data.generation,generationId,profileId,state:'STAGING' as const};
  const mapped:Dataset={profile,generation,stores:Object.fromEntries(STORES.map(name=>[name,archive.data.stores[name].map(row=>({...row,generationId}))])) as Record<Store,Row[]>,blobs:archive.data.blobs};
  const targetSeal=await fingerprint(mapped);
  if(typeof navigator!=='undefined'&&navigator.storage?.estimate){const estimate=await navigator.storage.estimate();if(estimate.quota!==undefined&&estimate.usage!==undefined&&estimate.quota-estimate.usage<blob.size*1.25)fail('복원 작업 공간이 부족해요. 기존 정원은 지우지 않습니다.');}
  await db.transaction('rw',[db.meta,db.profiles,db.generationRegistry],async()=>{
    abortable(signal);const meta=await session(db,expected);
    for(const prior of await listBackupJobs(db))if(prior.kind==='RESTORE'&&prior.backupId===archive.manifest.backupId){if(prior.digest!==archive.manifest.snapshotDigest)fail('동일 backupId의 내용이 달라졌어요.');if(['STAGING','SEALING','READY','ACTIVE'].includes(prior.state))fail('이미 가져온 백업입니다. 기존 작업·정원을 확인해 주세요.');}
    await db.profiles.add(profile);await db.generationRegistry.add(generation);
    await putJob(db,{id,kind:'RESTORE',state:'STAGING',source:expected,sourceProfileId:meta.activeProfileId,profileId,generationId,backupId:archive.manifest.backupId,digest:archive.manifest.snapshotDigest,seal:targetSeal,createdAt:now,updatedAt:now,contentRevision:0,progress:0,counts:archive.manifest.entityCounts});
  });
  try{
    for(const name of STORES){const rows=archive.data.stores[name];for(let offset=0;offset<rows.length;offset+=100){
      await db.transaction('rw',[db.meta,db.profiles,db.generationRegistry,db.table(name)],async()=>{
        abortable(signal);await session(db,expected);const current=await job(db,id);if(current.state!=='STAGING')fail('중단되거나 봉인된 복원 작업입니다.');
        const batch=rows.slice(offset,offset+100).map(row=>({...row,generationId,...(name==='mediaBlobs'?{blob:archive.data.blobs.get(row.id)}:{})}));
        await db.table(name).bulkAdd(batch);await putJob(db,{...current,contentRevision:current.contentRevision+1,progress:current.progress+batch.length});
      });
    }}
    return await sealBackup(db,id,signal);
  }catch(error){await cancelBackup(db,id,!signal?.aborted).catch(()=>{});throw error;}
}
export async function sealBackup(db:SikmulwangDB,id:string,signal?:AbortSignal):Promise<BackupJob>{
  const expected=await db.transaction('rw',[db.meta,db.profiles,db.generationRegistry],async()=>{abortable(signal);const current=await job(db,id);await session(db,current.source);if(!['STAGING','SEALING','READY'].includes(current.state))fail('검증할 수 없는 복원 상태입니다.');const next={...current,state:'SEALING' as const};await putJob(db,next);return next;});
  const snapshot=await db.transaction('r',db.tables,()=>readDataset(db,expected.generationId!));
  await validateDataset(snapshot,signal);
  if(STORES.some(n=>snapshot.stores[n].length!==expected.counts?.[n]))fail('스테이징 데이터 건수가 일치하지 않아요.');
  const seal=await fingerprint(snapshot);
  return db.transaction('rw',[db.meta,db.profiles,db.generationRegistry],async()=>{abortable(signal);await session(db,expected.source);const current=await job(db,id);if(current.state!=='SEALING'||current.contentRevision!==expected.contentRevision)fail('복원 작업이 변경되었어요. 다시 검증해 주세요.');if(expected.seal&&expected.seal!==seal)fail('봉인된 복원 데이터가 변경됐어요.');const next={...current,state:'READY' as const,seal};await putJob(db,next);return next;});
}
export async function activateBackup(db:SikmulwangDB,id:string,signal?:AbortSignal){
  // SEALING prohibits further batches. Hash bytes outside the short promotion transaction.
  const verified=await sealBackup(db,id,signal);
  await db.transaction('rw',[db.meta,db.profiles,db.generationRegistry],async()=>{
    abortable(signal);const meta=await session(db,verified.source);const current=await job(db,id);
    if(current.state!=='READY'||current.contentRevision!==verified.contentRevision||current.seal!==verified.seal)fail('복원 봉인이 달라졌어요.');
    const gen=await db.generationRegistry.get(current.generationId!),profile=await db.profiles.get(current.profileId!),old=await db.generationRegistry.get(meta.activeGenerationId);
    if(!gen||gen.state!=='STAGING'||gen.profileId!==profile?.profileId||profile.currentGenerationId!==gen.generationId||!old||!Number.isSafeInteger(meta.epoch+1))fail('안전하게 정원을 전환할 수 없어요.');
    const now=new Date().toISOString();await db.generationRegistry.put({...old!,state:'ARCHIVED',updatedAt:now});await db.generationRegistry.put({...gen!,state:'ACTIVE',updatedAt:now});
    await db.meta.bulkPut([{key:'activeProfileId',value:profile!.profileId,updatedAt:now},{key:'activeGenerationId',value:gen!.generationId,updatedAt:now},{key:'epoch',value:meta.epoch+1,updatedAt:now},{key:'writeFence',value:false,updatedAt:now}]);
    await putJob(db,{...current,state:'ACTIVE'});
  });
}
export async function archivedGardens(db:SikmulwangDB){return db.generationRegistry.where('state').equals('ARCHIVED').toArray();}
export async function activateArchived(db:SikmulwangDB,expected:Session,targetId:string,signal?:AbortSignal){
  // A retained original is revalidated before returning, with the same short atomic promotion.
  const data=await db.transaction('r',db.tables,()=>readDataset(db,targetId));await validateDataset(data,signal);
  await db.transaction('rw',db.tables,async()=>{abortable(signal);const meta=await session(db,expected);const current=await readDataset(db,targetId);if(current.generation.state!=='ARCHIVED'||await Dexie.waitFor(fingerprint(current))!==await Dexie.waitFor(fingerprint(data))||!Number.isSafeInteger(meta.epoch+1))fail('보관 정원이 변경됐어요.');const old=await db.generationRegistry.get(meta.activeGenerationId);const now=new Date().toISOString();await db.generationRegistry.put({...old!,state:'ARCHIVED',updatedAt:now});const retainedGen=await db.generationRegistry.get(targetId),retainedProfile=await db.profiles.get(current.profile.profileId);if(!retainedGen||!retainedProfile)fail();await db.generationRegistry.put({...retainedGen!,state:'ACTIVE',updatedAt:now});await db.profiles.put({...retainedProfile!,currentGenerationId:targetId});await db.meta.bulkPut([{key:'activeProfileId',value:current.profile.profileId,updatedAt:now},{key:'activeGenerationId',value:targetId,updatedAt:now},{key:'epoch',value:meta.epoch+1,updatedAt:now}]);});
}
