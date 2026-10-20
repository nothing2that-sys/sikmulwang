export const FACT_FIELDS = ['canonicalName', 'regionCode', 'growingMethod', 'startStage', 'plantingWindow', 'guide'] as const;
export type FactField = typeof FACT_FIELDS[number];
export interface Source {
  sourceId: string; endpoint: string; title: string; publishedAt: string;
  licenseId: 'KOGL-1'; allowedUse: 'COMMERCIAL_AND_NONCOMMERCIAL';
  transformAllowed: true; redistributionAllowed: true; reviewedAt: string;
  evidenceUrl: string; licenseEvidenceUrl: string; reviewer: string;
  allowedFields: FactField[];
}
export interface Fact { field: FactField; value: string | { start: string; end: string }; sourceId: string; locator: string; transformation: string }
export interface PublicPlant { id: string; taxonSnapshotId: string; canonicalName: string; facts: Fact[]; assessmentReadiness: 'GUIDE_ONLY' }
export interface PublicCatalog { version: string; sources: Source[]; plants: PublicPlant[] }
function fail(message: string): never { throw new Error('공식 카탈로그 검증 실패: ' + message); }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) fail('객체'); return value as Record<string, unknown>; }
function text(value: unknown): string { if (typeof value !== 'string' || !value.trim() || value.length > 2000 || value !== value.trim()) fail('문자열'); return value; }
function exactKeys(value: Record<string, unknown>, keys: string[]) { if (Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value,k))) fail('필드'); }
function officialUrl(value: unknown): string {
  const raw=text(value); let url: URL; try { url=new URL(raw); } catch { return fail('URL'); }
  if (url.protocol!=='https:' || url.hostname!=='www.rda.go.kr' || url.username || url.password || url.port || url.hash || url.pathname!=='/board/board.do' || url.searchParams.get('boardId')!=='farmprmninfo' || !/^\d+$/.test(url.searchParams.get('dataNo')??'')) fail('공식 본문 URL');
  return raw;
}
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value<'1900-01-01' || value>'2100-12-31') return false;
  const date=new Date(value+'T00:00:00Z'); return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10)===value;
}
export function validateCatalog(input: unknown): PublicCatalog {
  const root=object(input); exactKeys(root,['version','sources','plants']); text(root.version);
  if (!Array.isArray(root.sources)||!root.sources.length||!Array.isArray(root.plants)||!root.plants.length) fail('목록');
  const sourceMap=new Map<string, Source>();
  for (const raw of root.sources) {
    const s=object(raw); exactKeys(s,['sourceId','endpoint','title','publishedAt','licenseId','allowedUse','transformAllowed','redistributionAllowed','reviewedAt','evidenceUrl','licenseEvidenceUrl','reviewer','allowedFields']);
    const id=text(s.sourceId); if(sourceMap.has(id)) fail('중복 출처');
    officialUrl(s.endpoint); officialUrl(s.evidenceUrl);
    if(s.endpoint!==s.evidenceUrl || s.licenseEvidenceUrl!=='https://www.kogl.or.kr/info/license.do' || s.licenseId!=='KOGL-1' || s.allowedUse!=='COMMERCIAL_AND_NONCOMMERCIAL' || s.transformAllowed!==true || s.redistributionAllowed!==true) fail('이용권한');
    text(s.title); text(s.reviewer); if(!validDate(text(s.publishedAt))||!validDate(text(s.reviewedAt))||String(s.reviewedAt)<String(s.publishedAt))fail('출처 확인일');
    if(!Array.isArray(s.allowedFields)||!s.allowedFields.length||new Set(s.allowedFields).size!==s.allowedFields.length||s.allowedFields.some(f=>!FACT_FIELDS.includes(f)))fail('허용 필드');
    sourceMap.set(id,s as unknown as Source);
  }
  const ids=new Set<string>(), snapshots=new Set<string>(), usedSources=new Set<string>();
  for (const raw of root.plants) {
    const p=object(raw); exactKeys(p,['id','taxonSnapshotId','canonicalName','facts','assessmentReadiness']);
    const id=text(p.id), snap=text(p.taxonSnapshotId); text(p.canonicalName);
    if(!/^rda-[a-z-]+$/.test(id)||ids.has(id)||snapshots.has(snap)||p.assessmentReadiness!=='GUIDE_ONLY')fail('식별자/출시 상태'); ids.add(id);snapshots.add(snap);
    if(!Array.isArray(p.facts)||!p.facts.length)fail('사실 목록'); const fields=new Set<string>();
    for(const rawFact of p.facts){
      const f=object(rawFact);exactKeys(f,['field','value','sourceId','locator','transformation']); const field=text(f.field) as FactField;
      const source=sourceMap.get(text(f.sourceId));if(!source||!source.allowedFields.includes(field)||fields.has(field))fail('필드별 출처');fields.add(field);usedSources.add(source.sourceId);text(f.locator);text(f.transformation);
      if(field==='plantingWindow'){const w=object(f.value);exactKeys(w,['start','end']);if(!validDate('2000-'+text(w.start))||!validDate('2000-'+text(w.end))||String(w.start)>String(w.end))fail('참고 창');}
      else {const value=text(f.value);if(field==='regionCode'&&value!=='KR_CENTRAL')fail('권역');if(field==='growingMethod'&&value!=='OUTDOOR_SOIL')fail('방법');if(field==='startStage'&&value!=='SEEDLING')fail('시작 형태');}
    }
    if(FACT_FIELDS.some(f=>!fields.has(f)))fail('누락 사실');
    if ((p.facts as Fact[]).find(f=>f.field==='canonicalName')?.value!==p.canonicalName)fail('식물명 불일치');
  }
  if(sourceMap.size!==usedSources.size)fail('미사용 출처');
  return input as PublicCatalog;
}
