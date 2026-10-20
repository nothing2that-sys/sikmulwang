import rawCatalog from '../../data/official-catalog.json';
import { validateCatalog, validDate, type FactField, type PublicPlant } from './catalog-contract';
export const catalog = validateCatalog(rawCatalog);
export const RULE_VERSION = 'p5-guide-v1';
export const INPUT_KEYS = ['q','region','method','stage','light','cultivar','date','until'] as const;
export type InputKey = typeof INPUT_KEYS[number];
export type Conditions = Record<InputKey,string>;
export const OPTIONS = {
  region: [['KR_CENTRAL','중부지방'],['KR_SOUTH','남부지방'],['KR_OTHER','그 밖의 권역']],
  method: [['OUTDOOR_SOIL','실외 텃밭'],['BALCONY_SOIL','베란다 화분'],['INDOOR_SOIL','실내 화분']],
  stage: [['SEEDLING','모종'],['SEED','씨앗']],
  light: [['DIRECT','직사광'],['BRIGHT_INDIRECT','밝은 간접광'],['LOW','빛이 적음']],
} as const;
export function readConditions(params: URLSearchParams): Conditions {
  return Object.fromEntries(INPUT_KEYS.map(k=>[k,params.get(k)??''])) as Conditions;
}
export function conditionsSearch(input: Conditions): string {
  const params=new URLSearchParams();for(const key of INPUT_KEYS)if(input[key])params.set(key,input[key]);
  const query=params.toString();return query?'?'+query:'';
}
export function factValue<T=string>(plant: PublicPlant, field: FactField): T {
  return plant.facts.find(f=>f.field===field)!.value as T;
}
export const REASONS = {
  INVALID_INPUT:'입력한 날짜나 조건을 확인해 주세요.',
  REGION_UNKNOWN:'권역을 선택해 주세요.', REGION_OUTSIDE_SOURCE:'선택한 권역에 적용할 자료가 없습니다.',
  METHOD_UNKNOWN:'재배 방식을 선택해 주세요.', METHOD_OUTSIDE_SOURCE:'선택한 재배 방식에 적용할 자료가 없습니다.',
  STAGE_UNKNOWN:'모종 또는 씨앗을 선택해 주세요.', STAGE_OUTSIDE_SOURCE:'이 자료는 모종 심기 기준이며 씨앗 파종 시기는 확인되지 않았습니다.',
  DATE_UNKNOWN:'재배 시작일을 선택해 주세요.', LIGHT_UNKNOWN:'빛 환경을 선택해 주세요.',
  CULTIVAR_UNKNOWN:'품종을 입력해 주세요.',
  CULTIVAR_EVIDENCE_MISSING:'품종별 공식 근거가 없습니다.', LIGHT_EVIDENCE_MISSING:'빛 조건별 공식 근거가 없습니다.',
  DURATION_EVIDENCE_MISSING:'수확까지의 재배기간 근거가 없습니다.',
  WINDOW_REFERENCE_ONLY:'재배창은 과거 공식 안내의 참고 범위이며 현재 지역 적기를 확정하지 않습니다.',
  AGRONOMIC_REVIEW_PENDING:'농업적 적합성 정답 검수가 완료되지 않았습니다.',
} as const;
export type Reason = keyof typeof REASONS;
export interface Assessment { status:'INFO_INSUFFICIENT'; reasonCodes:Reason[]; ruleVersion:string; referenceWindow:{start:string;end:string;position:'BEFORE'|'WITHIN'|'AFTER'}|null }
export function inputInvalid(input: Conditions): boolean {
  return (Object.keys(OPTIONS) as (keyof typeof OPTIONS)[]).some(key=>input[key]!==''&&!OPTIONS[key].some(([value])=>value===input[key])) ||
    (input.date!==''&&!validDate(input.date)) || (input.until!==''&&!validDate(input.until)) ||
    (validDate(input.date)&&validDate(input.until)&&input.until<input.date) || input.cultivar.length>100 || input.q.length>100;
}
export function assess(plant: PublicPlant, input: Conditions): Assessment {
  const reasons:Reason[]=[];
  if(inputInvalid(input))reasons.push('INVALID_INPUT');
  for(const [key,field,unknown,outside] of [
    ['region','regionCode','REGION_UNKNOWN','REGION_OUTSIDE_SOURCE'],
    ['method','growingMethod','METHOD_UNKNOWN','METHOD_OUTSIDE_SOURCE'],
    ['stage','startStage','STAGE_UNKNOWN','STAGE_OUTSIDE_SOURCE'],
  ] as const){if(!input[key])reasons.push(unknown);else if(input[key]!==factValue(plant,field))reasons.push(outside);}
  if(!input.date)reasons.push('DATE_UNKNOWN');if(!input.light)reasons.push('LIGHT_UNKNOWN');if(!input.cultivar.trim())reasons.push('CULTIVAR_UNKNOWN');
  reasons.push('CULTIVAR_EVIDENCE_MISSING','LIGHT_EVIDENCE_MISSING','DURATION_EVIDENCE_MISSING','WINDOW_REFERENCE_ONLY','AGRONOMIC_REVIEW_PENDING');
  const reference=factValue<{start:string;end:string}>(plant,'plantingWindow');
  let window:Assessment['referenceWindow']=null;
  if(!inputInvalid(input)&&validDate(input.date)){
    const year=input.date.slice(0,4),start=year+'-'+reference.start,end=year+'-'+reference.end;
    if(validDate(start)&&validDate(end))window={start,end,position:input.date<start?'BEFORE':input.date>end?'AFTER':'WITHIN'};
  }
  return {status:'INFO_INSUFFICIENT',reasonCodes:reasons,ruleVersion:RULE_VERSION,referenceWindow:window};
}
export function listCandidates(input: Conditions): PublicPlant[] {
  return catalog.plants.filter(p=>p.canonicalName.includes(input.q.trim())).sort((a,b)=>a.canonicalName<b.canonicalName?-1:a.canonicalName>b.canonicalName?1:a.taxonSnapshotId<b.taxonSnapshotId?-1:a.taxonSnapshotId>b.taxonSnapshotId?1:0);
}
