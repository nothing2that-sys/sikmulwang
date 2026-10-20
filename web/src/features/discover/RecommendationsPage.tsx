import { Link, useParams, useSearchParams } from 'react-router-dom';
import { PageContainer, PageHeading } from '../../components/layout/PageContainer';
import { FormField } from '../../components/common/FormField';
import { EmptyState, PhaseNotice, StatusBadge } from '../../components/common/Feedback';
import { NotFoundPage } from '../../app/router/NotFoundPage';
import { assess, catalog, conditionsSearch, factValue, inputInvalid, listCandidates, OPTIONS, readConditions, REASONS, type Conditions, type InputKey } from '../../lib/recommendation/recommend';
import type { PublicPlant } from '../../lib/recommendation/catalog-contract';

function Evidence({plant,input,details=false}:{plant:PublicPlant;input:Conditions;details?:boolean}) {
  const result=assess(plant,input);
  const source=catalog.sources.find(s=>s.sourceId===plant.facts[0].sourceId)!;
  const window=factValue<{start:string;end:string}>(plant,'plantingWindow');
  return <>
    <StatusBadge>정보 부족</StatusBadge>
    <p>농촌진흥청 본문 참고: 중부지방 · 실외 텃밭 · 모종 · {window.start.replace('-','월 ')}일~{window.end.replace('-','월 ')}일</p>
    {plant.id==='rda-lettuce'&&<p className="field-hint">상추는 제목 요약과 본문의 시기가 달라 본문의 4월 중순을 참고합니다. 적기 확정에는 추가 확인이 필요해요.</p>}
    {result.referenceWindow&&<p>선택한 날짜는 참고 범위 {({BEFORE:'이전',WITHIN:'안',AFTER:'이후'} as const)[result.referenceWindow.position]}입니다. 적합·부적합 판정은 아닙니다.</p>}
    <p>내 환경 난이도: 판단 불가 · 수확일 예측: 보류</p>
    <ul className="recommend-reasons" aria-label={plant.canonicalName+' 정보 부족 사유'}>{result.reasonCodes.map(code=><li key={code}>{REASONS[code]}</li>)}</ul>
    <p><a href={source.endpoint} target="_blank" rel="noreferrer">농촌진흥청 원문: {source.title} (새 창)</a></p>
    <p className="field-hint">발행 {source.publishedAt} · 출처 확인 {source.reviewedAt} · 공공누리 제1유형 · 본문을 요약·정규화했습니다.</p>
    {details&&<>
      <h2>공식 본문을 요약한 관리 가이드</h2><p>{factValue(plant,'guide')}</p>
      <p>급수 주기와 기존 관리 일정은 이 안내로 변경되지 않습니다. 개별 환경·품종을 먼저 확인하세요.</p>
      <h2>근거와 자체 판단 구분</h2>
      <p>출처·이용표시는 Codex가 원문과 대조했습니다. 농업 전문가의 검수·기관 인증은 아닙니다. 식물왕 판정 규칙: {result.ruleVersion}. 현재 3종은 자료 안내만 제공하며 적합 등급은 보류합니다.</p>
      <ul>{plant.facts.map(f=><li key={f.field}>{f.locator} — {f.transformation}</li>)}</ul>
      <p><a href={source.licenseEvidenceUrl} target="_blank" rel="noreferrer">공공누리 이용조건 (새 창)</a></p>
      <p>사진·첨부파일은 채택하지 않았습니다. 공개 자료 목록은 앱에 포함되어 오프라인에서도 읽을 수 있으나 원문 링크는 인터넷이 필요합니다.</p>
      <Link className="text-link" to="/plants">내 식물에서 직접 등록하기</Link>
    </>}
  </>;
}
export function RecommendationsPage() {
  const [params,setParams]=useSearchParams();const input=readConditions(params),search=conditionsSearch(input),results=listCandidates(input);
  function update(key:InputKey,value:string,replace=false){setParams(conditionsSearch({...input,[key]:value}),{replace});}
  return <PageContainer>
    <Link className="text-link" to="/discover">개발용 샘플 탐색으로</Link>
    <PageHeading eyebrow="공식 근거 확인" title="근거로 식물 찾기" description="확인된 자료와 아직 모르는 조건을 함께 살펴보세요." />
    <PhaseNotice>공식 본문을 확인한 3종의 참고 안내입니다. 품종·빛·재배기간 근거와 농업적 정답 검수가 부족하여 현재 적합성은 모두 정보 부족입니다.</PhaseNotice>
    <section className="card filter-panel" aria-label="추천 조건">
      <p>지역은 직접 선택합니다. 입력 조건은 주소에 남으므로 공유할 때 확인하세요. 개인 기록은 읽거나 변경하지 않습니다.</p>
      <FormField id="reco-q" label="공식 자료 식물 검색"><input id="reco-q" type="search" maxLength={100} value={input.q} onChange={e=>update('q',e.target.value,true)} /></FormField>
      <div className="filter-grid">
        {(Object.keys(OPTIONS) as (keyof typeof OPTIONS)[]).map(key=><FormField key={key} id={'reco-'+key} label={{region:'권역',method:'재배 방식',stage:'시작 형태',light:'빛 환경'}[key]}>
          <select id={'reco-'+key} value={input[key]} onChange={e=>update(key,e.target.value)}>
            <option value="">모름 / 선택 안 함</option>
            {input[key]&&!OPTIONS[key].some(([value])=>value===input[key])&&<option value={input[key]}>지원하지 않는 입력</option>}
            {OPTIONS[key].map(([value,label])=><option key={value} value={value}>{label}</option>)}
          </select>
        </FormField>)}
        <FormField id="reco-cultivar" label="품종"><input id="reco-cultivar" maxLength={100} value={input.cultivar} onChange={e=>update('cultivar',e.target.value,true)} placeholder="모르면 비워 두세요" /></FormField>
        <FormField id="reco-date" label="재배 시작일"><input id="reco-date" type="date" min="1900-01-01" max="2100-12-31" value={input.date} onChange={e=>update('date',e.target.value)} /></FormField>
        <FormField id="reco-until" label="재배 공간 이용 종료일 (선택)"><input id="reco-until" type="date" min="1900-01-01" max="2100-12-31" value={input.until} onChange={e=>update('until',e.target.value)} /></FormField>
      </div>
      <button className="text-link" type="button" onClick={()=>setParams({})}>추천 조건 초기화</button>
      {inputInvalid(input)&&<p role="alert">입력한 날짜나 조건을 확인해 주세요. 잘못된 주소 입력을 적합 판정에 사용하지 않습니다.</p>}
    </section>
    <p role="status">공식 자료 {results.length}종 · 적합 등급 제공 보류</p>
    {results.length?<div className="recommend-grid">{results.map(plant=><article className="card" key={plant.id}>
      <h2>{plant.canonicalName}</h2><Evidence plant={plant} input={input}/>
      <Link className="text-link" to={'/discover/recommendations/'+plant.id+search}>{plant.canonicalName} 공식 자료 상세</Link>
    </article>)}</div>:<EmptyState title="일치하는 공식 자료가 없어요" description="검색을 바꾸거나 조건을 초기화하세요. 미확인 식물을 자동으로 추천하지 않습니다."/>}
  </PageContainer>;
}
export function OfficialPlantDetailPage(){
  const {id}=useParams();const [params]=useSearchParams();const input=readConditions(params),plant=catalog.plants.find(p=>p.id===id);
  if(!plant)return <NotFoundPage/>;
  return <PageContainer>
    <Link className="text-link" to={'/discover/recommendations'+conditionsSearch(input)}>공식 자료 목록으로</Link>
    <PageHeading eyebrow="공식 자료 · 참고 안내" title={plant.canonicalName} description="원문 사실과 식물왕의 보류 판단을 구분합니다." />
    <section className="card"><Evidence plant={plant} input={input} details/></section>
  </PageContainer>;
}
