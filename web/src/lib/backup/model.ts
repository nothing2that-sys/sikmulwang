import type { ProfileRecord, GenerationRecord, CareEventRecord, ObservationRecord } from '../db/types';
import { ValidationError } from '../db/errors';
import { validateLocalDate, validateTimeZone, validateEffectiveTimestamp } from '../db/validators';
import { canonical, sha256, evaluate, type RuleInput, type Rule } from '../care/engine';
import { stripPngMetadata } from '../journal/photo';
import { effective } from '../care/repository';
export const STORES = ['locations','environmentHistory','plantings','cycles','userPreferences','taxonSnapshots','careEvents','observations','taskOccurrences','taskChanges','careRules','ruleSnapshots','decisionLogs','diaries','media','mediaBlobs','mediaLinks','harvests','riskNotices','feedbackOverrides'] as const;
export type Store = typeof STORES[number];
export type Row = Record<string,unknown> & { id: string; generationId: string };
export interface Dataset { profile: ProfileRecord; generation: GenerationRecord; stores: Record<Store,Row[]>; blobs: Map<string,Blob> }
export const LIMITS = { archive:300*1024*1024,total:256*1024*1024,blob:32*1024*1024,json:8*1024*1024,entries:20100,rows:20000,ratio:100,metadata:32*1024*1024 };
export const fail = (reason = '백업 데이터가 지원 계약과 일치하지 않아요. 기존 데이터는 보존됩니다.'): never => { throw new ValidationError(reason); };
export function object(value: unknown): Record<string,unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(); return value as Record<string,unknown>; }
export function string(value: unknown): string { if (typeof value !== 'string' || !value.length) fail(); return value as string; }
export function integer(value: unknown,min=0): number { if (!Number.isSafeInteger(value) || (value as number)<min) fail(); return value as number; }
function enumeration(value: unknown,values: readonly unknown[]) { if(!values.includes(value)) fail(); }
export function safeJson(text: string): unknown {
  const result:unknown=JSON.parse(text,(key,value:unknown)=>{if(['__proto__','constructor','prototype'].includes(key))fail();return value;});
  const pending:{value:unknown;depth:number}[]=[{value:result,depth:0}];let nodes=0;while(pending.length){const {value,depth}=pending.pop()!;if(++nodes>1000000||depth>64)fail('JSON 중첩·항목 한도를 넘어요.');if(value&&typeof value==='object')for(const item of Object.values(value))pending.push({value:item,depth:depth+1});}return result;
}
export async function hashBlob(blob: Blob): Promise<string> { if(blob.size>LIMITS.blob) fail('개별 사진이 32MiB 한도를 넘어요. 원본은 보존됩니다.'); return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),n=>n.toString(16).padStart(2,'0')).join(''); }
export const jsonBlob = (value: unknown) => new Blob([canonical(value)],{ type:'application/json' });
export const sorted = (rows: Row[]) => [...rows].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
export function mediaPath(row: Row,media: Row) {
  const ext: Record<string,string>={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'};
  const suffix=ext[string(media.mimeType)];if(!suffix) fail('지원하지 않는 사진 MIME 형식입니다.');
  enumeration(row.variant,['DISPLAY','THUMBNAIL','ORIGINAL']);
  return `media/${encodeURIComponent(string(row.mediaId))}/${string(row.variant)}.${suffix}`;
}
export async function fingerprint(data: Dataset): Promise<string> {
  // Blob hashes are verified separately; descriptor bytes participate in this immutable seal.
  return sha256(canonical({ profile:data.profile,generation:data.generation,stores:Object.fromEntries(STORES.map(name=>[name,sorted(data.stores[name])])) }));
}
const fields: Record<Store,string[]> = {
  locations:['label','environmentType','rainfallExposure','sunExposure','timeZone'], environmentHistory:['plantingId','locationId','validFrom'],
  plantings:['displayName','groupType','unit','locationId','growingStatus'], cycles:['plantingId','startLocalDate','timeZone','status'],
  userPreferences:['timeZone'],taxonSnapshots:['canonicalName','taxonRank','sourceKind','sourceVersion'],
  careEvents:['cycleId','actionKind','occurredAt','idempotencyKey','eventStatus'], observations:['cycleId','observationKind','value','occurredAt','idempotencyKey','eventStatus'],
  taskOccurrences:['cycleId','actionKind','anchorId','dueLocalDate','status'],taskChanges:['taskId','previousState','nextState','idempotencyKey','requestBody','sourceId','occurredAt'],
  careRules:['version','actionKind','cycleId','applicability','provenance'],ruleSnapshots:['stableRuleId','version','normalizedBody','sha256'],
  decisionLogs:['idempotencyKey','requestBody','targetType','targetId','algorithmVersion','inputSnapshot','outputSnapshot','inputDigest','ruleSnapshotHash','evaluatedAt'],
  diaries:['cycleId','entryLocalDate','timeZone','draftState'],media:['mimeType','sha256','privacyState'],mediaBlobs:['mediaId','variant','sha256'],
  mediaLinks:['ownerType','ownerId','mediaId'],harvests:['cycleId','careEventId','unit','occurredAt','status'],riskNotices:['cycleId','riskKind','dedupeKey','state','validFrom','expiresAt','sourceSnapshot'],feedbackOverrides:['scope','targetId','overrideKind','value','reason','updatedAt'],
};
export async function validateDataset(data: Dataset,signal?: AbortSignal): Promise<void> {
  if(Object.keys(data.profile).some(k=>!['profileId','name','currentGenerationId','createdAt','updatedAt'].includes(k))||Object.keys(data.generation).some(k=>!['generationId','profileId','state','schemaVersion','createdAt','updatedAt'].includes(k)))fail('알 수 없는 소유 metadata 필드입니다.');
  string(data.profile.profileId);string(data.profile.name);string(data.generation.generationId);string(data.generation.profileId);
  if(data.generation.profileId!==data.profile.profileId || data.profile.currentGenerationId!==data.generation.generationId || data.generation.schemaVersion!==1) fail();
  enumeration(data.generation.state,['ACTIVE','STAGING','ARCHIVED']);
  for(const row of [data.profile,data.generation]) { validateEffectiveTimestamp(row.createdAt); validateEffectiveTimestamp(row.updatedAt); }
  const indexes = {} as Record<Store,Map<string,Row>>;
  for(const name of STORES) {
    signal?.throwIfAborted();const rows=data.stores[name];if(!Array.isArray(rows)||rows.length>LIMITS.rows) fail();
    indexes[name]=new Map();
    for(const row of rows) {
      object(row);if(string(row.id).length>512)fail();if(row.generationId!==data.generation.generationId || indexes[name].has(row.id)) fail();
      indexes[name].set(row.id,row);
      for(const key of fields[name]) string(row[key]);
      if(['locations','environmentHistory','plantings','cycles','userPreferences','careEvents','observations','taskOccurrences','taskChanges','careRules','ruleSnapshots','decisionLogs'].includes(name)||row.journalVersion===1){validateEffectiveTimestamp(row.createdAt);validateEffectiveTimestamp(row.updatedAt);integer(row.revision,1);if(row.schemaVersion!==1)fail();}
      if(row.schemaVersion!==undefined && row.schemaVersion!==1) fail('미래 레코드 형식은 복원할 수 없어요. 파일과 원본은 보존됩니다.');
      if(row.createdAt!==undefined) validateEffectiveTimestamp(row.createdAt);
      if(row.updatedAt!==undefined) validateEffectiveTimestamp(row.updatedAt);
      if(row.revision!==undefined) integer(row.revision,1);
      if(['locations','environmentHistory','plantings','cycles','userPreferences'].includes(name)&&row.recordStatus===undefined)fail();
      if(row.journalVersion===1)enumeration(row.recordStatus,['ACTIVE','TRASHED']);
      if(row.recordStatus!==undefined) enumeration(row.recordStatus,['ACTIVE','TRASHED','PURGED']);
    }
  }
  const fk=(store: Store,id: unknown) => {const row=indexes[store].get(string(id));if(!row) fail(`백업의 ${store} 참조가 손상됐어요.`);return row!;};
  const optionalFk=(store:Store,id:unknown)=> { if(id!==null && id!==undefined) fk(store,id); };
  const unique=(rows:Row[],key:(r:Row)=>string)=>{const values=rows.map(key);if(new Set(values).size!==values.length)fail('백업의 유일 키가 중복됐어요.');};
  const s=data.stores;
  for(const r of s.locations) { enumeration(r.environmentType,['INDOOR','BALCONY','OUTDOOR','GREENHOUSE']);enumeration(r.rainfallExposure,['COVERED','EXPOSED','SHELTERED']);enumeration(r.sunExposure,['FULL_SUN','PARTIAL_SUN','SHADE','ARTIFICIAL']);validateTimeZone(string(r.timeZone)); }
  for(const r of s.plantings) { fk('locations',r.locationId);optionalFk('taxonSnapshots',r.taxonSnapshotId);optionalFk('plantings',r.splitFromPlantingId);integer(r.quantity,1);enumeration(r.groupType,['GROUP','INDIVIDUAL']);if(r.groupType==='INDIVIDUAL'&&r.quantity!==1)fail();enumeration(r.growingStatus,['GROWING','HARVESTED','DORMANT','DEAD']); }
  for(const r of s.environmentHistory) { fk('plantings',r.plantingId);fk('locations',r.locationId);validateEffectiveTimestamp(r.validFrom);if(r.validTo!==null){validateEffectiveTimestamp(r.validTo);if(string(r.validTo)<string(r.validFrom))fail();}const env=object(r.environmentSnapshot);validateTimeZone(string(env.timeZone)); }
  for(const r of s.cycles) {fk('plantings',r.plantingId);validateLocalDate(string(r.startLocalDate));validateTimeZone(string(r.timeZone));enumeration(r.status,['ACTIVE','ENDED']);if(r.endLocalDate!==null){validateLocalDate(string(r.endLocalDate));if(string(r.endLocalDate)<string(r.startLocalDate))fail();}if(r.status==='ENDED'&&r.endLocalDate===null)fail();}
  unique(s.cycles.filter(r=>r.status==='ACTIVE'&&r.recordStatus!=='PURGED'),r=>string(r.plantingId));
  for(const r of s.userPreferences) {validateTimeZone(string(r.timeZone));optionalFk('locations',r.locationSetting);integer(r.defaultInspectionDays,1);const prefs=object(r.notificationPreferences);if(Object.values(prefs).some(v=>typeof v!=='boolean'))fail();}
  for(const name of ['careEvents','observations'] as const) {unique(s[name],r=>string(r.idempotencyKey));for(const r of s[name]){fk('cycles',r.cycleId);validateEffectiveTimestamp(r.occurredAt);optionalFk(name,r.correctionOfId);}effective(s[name] as unknown as CareEventRecord[] & ObservationRecord[]);}
  for(const r of s.careEvents) enumeration(r.actionKind,['WATERED']);
  for(const r of s.observations){enumeration(r.observationKind,['MOIST']);enumeration(r.value,['MOIST']);}
  unique(s.taskOccurrences.filter(r=>r.status==='OPEN'||r.status==='SNOOZED'),r=>string(r.cycleId));
  unique(s.taskOccurrences,r=>`${r.cycleId}/${r.actionKind}/${r.occurrenceSeq}`);
  for(const r of s.taskOccurrences) {enumeration(r.actionKind,['SOIL_CHECK']);fk('cycles',r.cycleId);integer(r.occurrenceSeq);if(typeof r.priority!=='number'||!Number.isFinite(r.priority))fail();validateLocalDate(string(r.dueLocalDate));enumeration(r.status,['OPEN','SNOOZED','RESOLVED','CANCELLED']);if(r.id!==`${r.cycleId}/${r.actionKind}/${r.occurrenceSeq}`)fail();if(r.status==='RESOLVED'){const store=r.resolutionType==='CARE_EVENT'?'careEvents':r.resolutionType==='OBSERVATION'?'observations':fail();const event=fk(store,r.resolutionId);if(event.cycleId!==r.cycleId||event.eventStatus!=='ACTIVE'||s[store].some(child=>child.correctionOfId===event.id))fail();}else if(r.resolutionId!==null||r.resolutionType!==null)fail();}
  for(const r of s.taskChanges) {fk('taskOccurrences',r.taskId);validateEffectiveTimestamp(r.occurredAt);safeJson(string(r.previousState));safeJson(string(r.nextState));safeJson(string(r.requestBody));}
  for(const r of s.careRules) {enumeration(r.actionKind,['SOIL_CHECK']);if(r.inspectionDays===null)fail('현재 writer가 지원하지 않는 관리 규칙입니다.');fk('cycles',r.cycleId);if(r.inspectionDays!==null){integer(r.inspectionDays,1);if(Number(r.inspectionDays)>30)fail();}enumeration(r.provenance,['USER_OVERRIDE','PRODUCT_GUIDANCE']);}
  for(const r of s.ruleSnapshots) {
    const body=object(safeJson(string(r.normalizedBody)));if(await sha256(string(r.normalizedBody))!==r.sha256||body.id!==r.stableRuleId||body.version!==r.version)fail('규칙 snapshot의 본문·해시·식별자가 일치하지 않아요.');
    const rule=indexes.careRules.get(string(r.stableRuleId));if(rule&&canonical({id:rule.id,version:rule.version,kind:'SOIL_CHECK',inspectionDays:rule.inspectionDays,provenance:rule.provenance})!==r.normalizedBody)fail();
    if(r.aliasOfId!==undefined){const original=fk('ruleSnapshots',r.aliasOfId);if(original.sha256!==r.sha256||original.normalizedBody!==r.normalizedBody)fail();}
  }
  for(const r of s.decisionLogs) {
    if(r.algorithmVersion!=='rules-v1'||!Array.isArray(r.ruleSnapshotIds))fail();const input=object(safeJson(string(r.inputSnapshot))),output=object(safeJson(string(r.outputSnapshot))),evidence=object(output.evidence);
    if(await sha256(string(r.inputSnapshot))!==r.inputDigest||evidence.inputDigest!==r.inputDigest||evidence.ruleSnapshotHash!==r.ruleSnapshotHash)fail('결정 로그 digest가 일치하지 않아요.');
    if(r.targetType==='TASK')fk('taskOccurrences',r.targetId);else if(r.targetType==='CARE_RECORD'){if(!indexes.careEvents.has(string(r.targetId))&&!indexes.observations.has(string(r.targetId))&&!indexes.cycles.has(string(r.targetId)))fail();}else fail();
    for(const id of r.ruleSnapshotIds as unknown[]){const snapshot=fk('ruleSnapshots',id);if(snapshot.sha256!==r.ruleSnapshotHash)fail();}
    if(evidence.ruleSnapshotId!==null){const snapshot=fk('ruleSnapshots',evidence.ruleSnapshotId);if(snapshot.sha256!==r.ruleSnapshotHash)fail();}else if(r.ruleSnapshotHash!==await sha256('null'))fail();
    const snapshot=evidence.ruleSnapshotId===null?undefined:indexes.ruleSnapshots.get(String(evidence.ruleSnapshotId));
    const rule=snapshot?safeJson(String(snapshot.normalizedBody)) as Rule:null;
    if(canonical(await evaluate(input as unknown as RuleInput,rule))!==canonical(output))fail('결정 로그의 규칙 재현 결과가 일치하지 않아요.');
    optionalFk('taskOccurrences',r.resultTaskId);fk('cycles',input.cycleId);validateEffectiveTimestamp(r.evaluatedAt);safeJson(string(r.requestBody));
  }
  for(const r of s.diaries) {const cycle=fk('cycles',r.cycleId);validateLocalDate(string(r.entryLocalDate));validateTimeZone(string(r.timeZone));if(r.timeZone!==cycle.timeZone||string(r.entryLocalDate)<string(cycle.startLocalDate)||(cycle.endLocalDate&&string(r.entryLocalDate)>string(cycle.endLocalDate)))fail();if(typeof r.body!=='string'||r.body.length>2000||(r.title!==null&&(typeof r.title!=='string'||r.title.length>100)))fail();enumeration(r.draftState,['DRAFT','PUBLISHED']);integer(r.revision,1);if(r.journalVersion!==undefined){if(r.journalVersion!==1||!Array.isArray(r.tags)||r.tags.length>10||r.tags.some(t=>typeof t!=='string'||t.length>30))fail();enumeration(r.photoRecovery,[undefined,null,'RESELECT_REQUIRED']);}}
  unique(s.mediaBlobs,r=>`${r.mediaId}:${r.variant}`);
  if(data.blobs.size!==s.mediaBlobs.length)fail();let total=0;
  for(const r of s.media) {enumeration(r.mimeType,['image/png','image/jpeg','image/webp']);integer(r.byteLength);if(!Array.isArray(r.variants)||new Set(r.variants as unknown[]).size!==(r.variants as unknown[]).length)fail();const variants=s.mediaBlobs.filter(b=>b.mediaId===r.id);if(variants.length!==(r.variants as unknown[]).length||variants.some(b=>!(r.variants as unknown[]).includes(b.variant)))fail();if(r.journalVersion!==undefined){if(r.journalVersion!==1||r.processingState!=='READY'||r.privacyState!=='STRIPPED')fail();}if(r.capturedAt!==null)validateEffectiveTimestamp(r.capturedAt);if(r.capturedLocalDate!==null)validateLocalDate(string(r.capturedLocalDate));}
  for(const r of s.mediaBlobs) {signal?.throwIfAborted();const media=fk('media',r.mediaId);mediaPath(r,media);integer(r.byteLength);const blob=data.blobs.get(r.id);if(!blob||blob.size!==r.byteLength||await hashBlob(blob)!==r.sha256)fail('사진 bytes·길이·해시가 일치하지 않아요.');total+=blob!.size;if(total>LIMITS.total)fail('백업 데이터가 256MiB 한도를 넘어요. 원본은 보존됩니다.');const head=new Uint8Array(await blob!.slice(0,12).arrayBuffer());const mime=String(media.mimeType);if(mime==='image/png'&&![137,80,78,71,13,10,26,10].every((v,i)=>head[i]===v)||mime==='image/jpeg'&&(head[0]!==255||head[1]!==216)||mime==='image/webp'&&(String.fromCharCode(...head.slice(0,4))!=='RIFF'||String.fromCharCode(...head.slice(8,12))!=='WEBP'))fail('사진 MIME과 실제 bytes가 일치하지 않아요.');if(media.journalVersion===1){if(media.mimeType!=='image/png'||!['DISPLAY','THUMBNAIL'].includes(String(r.variant)))fail();const bytes=new Uint8Array(await blob!.arrayBuffer());if(stripPngMetadata(bytes).length!==bytes.length)fail('위치정보 제거 표시본에 불필요한 metadata가 있어요.');const view=new DataView(bytes.buffer);const limit=r.variant==='DISPLAY'?1600:320;if(view.getUint32(16)>limit||view.getUint32(20)>limit)fail();}
    if(r.variant==='DISPLAY'&&(media.sha256!==r.sha256||media.byteLength!==r.byteLength))fail();}
  unique(s.mediaLinks,r=>`${r.ownerType}:${r.ownerId}:${r.mediaId}`);
  for(const r of s.mediaLinks) {fk('media',r.mediaId);const store=r.ownerType==='DIARY'?'diaries':r.ownerType==='OBSERVATION'?'observations':r.ownerType==='PLANTING'?'plantings':fail();fk(store,r.ownerId);integer(r.sortOrder);}
  unique(s.harvests,r=>string(r.careEventId));for(const r of s.harvests){const event=fk('careEvents',r.careEventId);fk('cycles',r.cycleId);if(event.cycleId!==r.cycleId||event.actionKind!=='HARVEST'||typeof r.quantity!=='number'||!Number.isFinite(r.quantity)||r.quantity<0)fail();validateEffectiveTimestamp(r.occurredAt);}
  for(const r of s.riskNotices){fk('cycles',r.cycleId);validateEffectiveTimestamp(r.validFrom);validateEffectiveTimestamp(r.expiresAt);}
  signal?.throwIfAborted();
}
