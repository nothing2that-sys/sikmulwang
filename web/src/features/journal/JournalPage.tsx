import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft,ChevronRight } from 'lucide-react';
import { PageContainer,PageHeading } from '../../components/layout/PageContainer';
import { FormField } from '../../components/common/FormField';
import { calendarCells } from './calendar';
import { useJournalData,PhotoPreview } from './useJournalData';
import { isJournalEntry,setEntryTrash } from '../../lib/journal/repository';
import { effective } from '../../lib/care/repository';
import { localDate } from '../../lib/care/engine';
export function JournalPage() {
  const { db,meta,plantings,trashedPlantings,cycles,entries,links,blobs,care,observations,readError,error } = useJournalData();
  const [view,setView] = useState('타임라인'), [plant,setPlant] = useState(''), [trash,setTrash] = useState(false), [failure,setFailure] = useState(''), [day,setDay] = useState('');
  const [month,setMonth] = useState(() => new Date(new Date().getFullYear(),new Date().getMonth(),1));
  const allPlants = [...plantings,...trashedPlantings];
  const selectedCycles = cycles.filter(c => !plant || c.plantingId === plant);
  const cycleIds = new Set(selectedCycles.map(c => c.id));
  const visible = entries.filter(e => cycleIds.has(e.cycleId) && (trash ? e.recordStatus === 'TRASHED' : e.recordStatus !== 'TRASHED'));
  const events = [...effective(care).map(c => ({ ...c,label: `관리 기록 · ${c.actionKind}` })),...effective(observations).map(o => ({ ...o,label: `관찰 기록 · ${o.observationKind}` }))].filter(e => cycleIds.has(e.cycleId));
  const timeline = [
    ...visible.map(entry => ({ date: entry.entryLocalDate,id: `diary-${entry.id}`,entry,event: null })),
    ...(!trash ? events.map(event => ({ date: localDate(event.occurredAt,cycles.find(c => c.id === event.cycleId)?.timeZone || 'Asia/Seoul'),id: `event-${event.id}`,entry: null,event })) : []),
  ].sort((a,b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const cells = calendarCells(month.getFullYear(),month.getMonth());
  const prefix = `${month.getFullYear()}-${String(month.getMonth()+1).padStart(2,'0')}`;
  return <PageContainer><PageHeading eyebrow="쌓여가는 초록의 하루" title="일기장" description="일기 날짜를 기준으로 관리 기록과 함께 볼 수 있어요." action={<Link className="button" to="/journal/new">일기 쓰기</Link>} />
    {(readError || failure || error) && <p role="alert">{readError || failure || '저장소를 열지 못했어요.'}</p>}
    <div className="journal-toolbar"><div className="segmented" aria-label="일기 보기 방식">{['타임라인','달력'].map(v => <button type="button" key={v} aria-pressed={view === v} onClick={() => { setView(v); setDay(''); }}>{v}</button>)}</div>
    <FormField id="journal-plant" label="식물별 보기"><select id="journal-plant" value={plant} disabled={!allPlants.length} onChange={e => setPlant(e.target.value)}><option value="">전체 식물</option>{allPlants.map(p => <option key={p.id} value={p.id}>{p.displayName}</option>)}</select></FormField>
    <label><input type="checkbox" checked={trash} onChange={e => setTrash(e.target.checked)} />일기 휴지통 보기</label></div>
    {view === '달력' && <section className="card calendar-panel"><div className="calendar-heading"><button type="button" className="icon-button" aria-label="이전 달" onClick={() => { setMonth(new Date(month.getFullYear(),month.getMonth()-1,1)); setDay(''); }}><ChevronLeft /></button><h2>{month.getFullYear()}년 {month.getMonth()+1}월</h2><button type="button" className="icon-button" aria-label="다음 달" onClick={() => { setMonth(new Date(month.getFullYear(),month.getMonth()+1,1)); setDay(''); }}><ChevronRight /></button></div>
    <table className="calendar"><caption className="sr-only">{month.getFullYear()}년 {month.getMonth()+1}월 일기 달력</caption><thead><tr>{['일','월','화','수','목','금','토'].map(d => <th scope="col" key={d}>{d}</th>)}</tr></thead><tbody>{Array.from({ length: cells.length/7 },(_,r) => <tr key={r}>{cells.slice(r*7,r*7+7).map((d,c) => { const date = `${prefix}-${String(d).padStart(2,'0')}`; const count = timeline.filter(t => t.date === date).length; return <td key={c}>{d && <button type="button" className="calendar-day" aria-pressed={day === date} aria-label={`${date} 기록 ${count}개`} onClick={() => setDay(date)}>{d}{count > 0 && <span> · {count}</span>}</button>}</td>; })}</tr>)}</tbody></table>
    <button className="button secondary" type="button" onClick={() => setDay('')}>이번 달 전체 기록</button></section>}
    <section aria-label="저장된 기록" className="card">{!timeline.length && <p>저장된 일기가 없습니다. 식물과 시즌을 등록하고 첫 이야기를 남겨보세요.</p>}
    {timeline.filter(t => view !== '달력' || (day ? t.date === day : t.date.startsWith(prefix))).map(item => <article className="journal-entry" key={item.id}><p>{item.date} · {allPlants.find(p => p.id === cycles.find(c => c.id === (item.entry?.cycleId || item.event?.cycleId))?.plantingId)?.displayName}</p>{item.entry ? <>
      <h2>{item.entry.title || '제목 없는 일기'}</h2><p className="journal-body">{item.entry.body}</p>
      {isJournalEntry(item.entry) ? <><p>{item.entry.draftState === 'DRAFT' ? '영속 초안' : '저장된 일기'} · {item.entry.tags.join(', ')}</p><p className="muted">작성 시각: {item.entry.createdAt} · 시간대: {item.entry.timeZone}</p>
      <div className="journal-photos">{links.filter(l => l.ownerType === 'DIARY' && l.ownerId === item.entry!.id && l.recordStatus !== 'TRASHED').sort((a,b) => a.sortOrder-b.sortOrder).map(l => { const blob = blobs.find(b => b.mediaId === l.mediaId && b.variant === 'THUMBNAIL'); return blob ? <PhotoPreview key={l.id} blob={blob.blob} alt="일기 첨부 사진" /> : <p key={l.id}>사진을 읽지 못했어요. 원본은 보존됩니다.</p>; })}</div>
      <div className="button-row">{!trash && <Link className="button secondary" to={`/journal/new?id=${encodeURIComponent(item.entry.id)}`}>일기 편집</Link>}<button className="button secondary" type="button" onClick={() => { if (meta) void setEntryTrash(db,meta.epoch,meta.activeGenerationId,item.entry!.id,item.entry!.revision,!trash).catch(e => setFailure(e instanceof Error ? e.message : '변경하지 못했어요.')); }}>{trash ? '일기 복원' : '일기 휴지통으로'}</button></div></> : <p>이전 형식 기록 · 원본 보존 중</p>}
    </> : <><h2>{item.event?.label}</h2><p>관리 이력은 일기와 별도로 보존됩니다.</p></>}</article>)}</section>
  </PageContainer>;
}
