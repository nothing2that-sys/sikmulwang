import { describe,expect,it } from 'vitest';
import sourceData from '../data/official-catalog.json';
import expected from './fixtures/p5-source-expectations.json';
import { validateCatalog,validDate } from '../lib/recommendation/catalog-contract';
import { assess,catalog,conditionsSearch,factValue,inputInvalid,listCandidates,readConditions,type Conditions } from '../lib/recommendation/recommend';
const conditions:Conditions={q:'',region:'KR_CENTRAL',method:'OUTDOOR_SOIL',stage:'SEEDLING',light:'DIRECT',cultivar:'사용자 품종',date:'2026-04-15',until:'2026-11-30'};
const lettuce=catalog.plants.find(p=>p.id==='rda-lettuce')!;
function copy(){return structuredClone(sourceData);}
describe('P5 observed official source fixture, not agronomic approval',()=>{
  it('matches independently written text/window expectations and retains deterministic ordering',()=>{
    expect(listCandidates(conditions).map(p=>({id:p.id,name:p.canonicalName,sourceId:p.facts[0].sourceId,region:factValue(p,'regionCode'),method:factValue(p,'growingMethod'),stage:factValue(p,'startStage'),...factValue<object>(p,'plantingWindow'),status:assess(p,conditions).status}))).toEqual(expected);
    expect(catalog.plants).toEqual(sourceData.plants);
  });
  for(const [day,position] of [['2026-04-10','BEFORE'],['2026-04-11','WITHIN'],['2026-04-20','WITHIN'],['2026-04-21','AFTER']] as const)it('uses body window boundary '+day+' without suitable/unsuitable claim',()=>{
    const result=assess(lettuce,{...conditions,date:day});expect(result.referenceWindow?.position).toBe(position);expect(result.status).toBe('INFO_INSUFFICIENT');
  });
  it('does not convert source headline discrepancy into April 1 lettuce window',()=>{expect(factValue(lettuce,'plantingWindow')).toEqual({start:'04-11',end:'04-20'});expect(lettuce.facts.find(f=>f.field==='plantingWindow')?.locator).toContain('불일치');});
  for(const [field,code] of [['region','REGION_UNKNOWN'],['method','METHOD_UNKNOWN'],['stage','STAGE_UNKNOWN'],['light','LIGHT_UNKNOWN'],['cultivar','CULTIVAR_UNKNOWN'],['date','DATE_UNKNOWN']] as const)it('missing '+field+' stays unknown',()=>{const result=assess(lettuce,{...conditions,[field]:''});expect(result.reasonCodes).toContain(code);expect(result.status).toBe('INFO_INSUFFICIENT');});
  for(const [field,value,code] of [['region','KR_SOUTH','REGION_OUTSIDE_SOURCE'],['method','BALCONY_SOIL','METHOD_OUTSIDE_SOURCE'],['stage','SEED','STAGE_OUTSIDE_SOURCE']] as const)it('unsupported '+value+' is not biologically unsuitable',()=>{expect(assess(lettuce,{...conditions,[field]:value})).toMatchObject({status:'INFO_INSUFFICIENT',reasonCodes:expect.arrayContaining([code])});});
  it('known user fields do not invent cultivar/light/duration evidence or RULE-17',()=>{const r=assess(lettuce,{...conditions,until:'2026-04-16'});expect(r.status).toBe('INFO_INSUFFICIENT');expect(r.reasonCodes).toEqual(expect.arrayContaining(['CULTIVAR_EVIDENCE_MISSING','LIGHT_EVIDENCE_MISSING','DURATION_EVIDENCE_MISSING','AGRONOMIC_REVIEW_PENDING']));});
  for(const date of ['2026-02-30','2026-2-03','2026-04-15T00:00:00Z','0000-01-01','2101-01-01'])it('rejects invalid URL date '+date,()=>{expect(validDate(date)).toBe(false);const r=assess(lettuce,{...conditions,date});expect(r.referenceWindow).toBeNull();expect(r.reasonCodes).toContain('INVALID_INPUT');});
  it('handles leap year without local timezone and rejects reversed availability',()=>{expect(validDate('2024-02-29')).toBe(true);expect(validDate('2026-02-29')).toBe(false);expect(inputInvalid({...conditions,until:'2026-04-14'})).toBe(true);});
  it('roundtrips only allowed URL keys and preserves malformed input for explicit recovery',()=>{const input=readConditions(new URLSearchParams('q=상추&region=evil&date=2026-02-30&cultivar=한글&redirect=https://example.com&token=secret'));const query=conditionsSearch(input);expect(query).not.toContain('secret');expect(query).not.toContain('redirect');expect(readConditions(new URLSearchParams(query))).toEqual(input);expect(inputInvalid(input)).toBe(true);});
  it('retains filters when URLSearchParams.size is unavailable on baseline browsers',()=>{
    const descriptor=Object.getOwnPropertyDescriptor(URLSearchParams.prototype,'size')!;
    try {Object.defineProperty(URLSearchParams.prototype,'size',{configurable:true,get:()=>undefined});expect(readConditions(new URLSearchParams(conditionsSearch(conditions)))).toEqual(conditions);}
    finally {Object.defineProperty(URLSearchParams.prototype,'size',descriptor);}
  });
  it('search no match remains empty and reset does not alter catalog',()=>{expect(listCandidates({...conditions,q:'없는식물'})).toEqual([]);expect(listCandidates({...conditions,q:' 상추 '})).toEqual([lettuce]);expect(catalog.plants).toEqual(sourceData.plants);});
});
describe('P5 SOURCE-01/02 build and runtime fail closed',()=>{
  const mutations:[string,(d:ReturnType<typeof copy>)=>void][]=[
    ['unreviewed license',d=>{d.sources[0].licenseId='REVIEW_REQUIRED';}],['noncommercial',d=>{d.sources[0].licenseId='KOGL-2';}],['no transform',d=>{d.sources[0].transformAllowed=false;}],['no redistribution',d=>{d.sources[0].redistributionAllowed=false;}],['unapproved use',d=>{d.sources[0].allowedUse='UNKNOWN';}],['missing field authorization',d=>{d.sources[0].allowedFields=[];}],['unknown source',d=>{d.plants[0].facts[0].sourceId='unknown';}],['photo field',d=>{d.sources[0].allowedFields.push('photo');}],['remote host',d=>{d.sources[0].endpoint='https://evil.example/';}],['script URL',d=>{d.sources[0].evidenceUrl='javascript:alert(1)';}],['missing reviewer',d=>{d.sources[0].reviewer='';}],['invalid review date',d=>{d.sources[0].reviewedAt='2026-02-30';}],['positive release',d=>{d.plants[0].assessmentReadiness='APPROVED';}],['invalid reference window',d=>{d.plants[0].facts.find(f=>f.field==='plantingWindow')!.value={start:'02-30',end:'04-20'};}],['duplicate species',d=>{d.plants.push(d.plants[0]);}],['duplicate fact',d=>{d.plants[0].facts.push(d.plants[0].facts[0]);}],['missing fact',d=>{d.plants[0].facts.pop();}],['wrong plant name',d=>{d.plants[0].canonicalName='다른이름';}],['unapproved field',d=>{d.plants[0].facts[0].field='weather';}],['extra blob',d=>{Object.assign(d.plants[0],{image:'unlicensed.jpg'});}]
  ];
  for(const [name,mutate] of mutations)it('rejects '+name,()=>{const data=copy();mutate(data);expect(()=>validateCatalog(data)).toThrow('공식 카탈로그 검증 실패');});
});
