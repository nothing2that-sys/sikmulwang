import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { useDb } from '../../lib/db/DbContext';
import type { CareEventRecord, CycleRecord, ObservationRecord, TaskOccurrenceRecord } from '../../lib/db/types';
import { executeCare, effective, lastWatered, taskOrder, visibleTask, type CareCommand } from '../../lib/care/repository';
import { addDays, localDate } from '../../lib/care/engine';
import { ModalDialog } from '../../components/common/ModalDialog';

interface Data { cycles: CycleRecord[]; tasks: TaskOccurrenceRecord[]; events: CareEventRecord[]; observations: ObservationRecord[] }
function localTimestampInput(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2,'0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
export function CarePanel({week = false, plantingId}: {week?: boolean; plantingId?: string}) {
  const {db,meta,plantings} = useDb();
  const [data,setData] = useState<Data>({cycles:[],tasks:[],events:[],observations:[]});
  const [error,setError] = useState('');
  const [message,setMessage] = useState('');
  const [all,setAll] = useState(false);
  const [draft,setDraft] = useState<CareCommand | null>(null);
  const [busy,setBusy] = useState(false);
  useEffect(() => {
    if (!meta) return;
    const sub = liveQuery(async () => {
      const generation = meta.activeGenerationId;
      const [cycles,tasks,events,observations] = await Promise.all([db.cycles.where('generationId').equals(generation).toArray(),db.taskOccurrences.where('generationId').equals(generation).toArray(),db.careEvents.where('generationId').equals(generation).toArray(),db.observations.where('generationId').equals(generation).toArray()]);
      return {cycles,tasks,events,observations};
    }).subscribe({next:setData,error:e => setError(String(e))});
    return () => sub.unsubscribe();
  },[db,meta]);
  const cycles = data.cycles.filter(c => (!plantingId || c.plantingId === plantingId) && plantings.some(p => p.id === c.plantingId));
  const open = data.tasks.filter(t => visibleTask(t,cycles)).filter(t => {
    const c = cycles.find(c => c.id === t.cycleId)!;
    return Boolean(plantingId) || t.dueLocalDate <= addDays(localDate(new Date().toISOString(),c.timeZone),week ? 6 : 0);
  }).sort(taskOrder);
  const begin = (cycle: CycleRecord,kind: CareCommand['kind'],task?: TaskOccurrenceRecord, extra: Partial<CareCommand> = {}) => {
    setError(''); setMessage('');
    setDraft({cycleId:cycle.id,kind,taskId:task?.id,expectedRevision:task?.revision ?? cycle.revision,idempotencyKey:crypto.randomUUID(),occurredAt:new Date().toISOString(),...(kind === 'RULE' ? {inspectionDays:7} : {}),...(kind === 'SNOOZED' ? {dueLocalDate:addDays(localDate(new Date().toISOString(),cycle.timeZone),1)} : {}),...extra});
  };
  const save = async () => {
    if (!draft || !meta) return;
    setBusy(true); setError(''); setMessage('저장 중');
    try {
      const result = await executeCare(db,meta.epoch,meta.activeGenerationId,draft);
      const actual = result?.resolutionType === 'OBSERVATION' ? '촉촉함 관찰' : '물주기';
      setDraft(null); setMessage(result?.status === 'RESOLVED' && ['WATERED','MOIST'].includes(draft.kind) ? `저장 완료 · 현재 기록: ${actual} (중복 입력은 추가하지 않습니다)` : '저장 완료');
    }
    catch(e) { setError(e instanceof Error ? e.message : String(e)); setMessage('저장 실패 · 입력과 재시도 키를 유지했습니다.'); }
    finally { setBusy(false); }
  };
  return <section className="card space-section" aria-label={week ? '주간 실제 돌봄' : '실제 돌봄'}>
    <h2>{week ? '이번 주 토양 확인' : '오늘의 토양 확인'}</h2>
    <p>사용자가 정한 확인 간격입니다. 흙 상태를 보고 실제 급수 여부를 결정해 주세요. 공식 품종별 급수 처방이 아닙니다.</p>
    <p role="status">{message || `확인할 작업 ${open.length}개`}</p>
    {error && <p role="alert" className="field-error">{error}</p>}
    {(week || all ? open : open.slice(0,3)).map(task => {
      const cycle = cycles.find(c => c.id === task.cycleId)!;
      return <article className="card space-section" key={task.id}>
        <h3>{plantings.find(p => p.id === cycle.plantingId)?.displayName} · 흙 상태 확인</h3>
        <p>{task.dueLocalDate} · {task.status === 'SNOOZED' ? '연기됨' : '확인 필요'}</p>
        <div className="button-row">
          <button className="button" onClick={() => begin(cycle,'WATERED',task)}>물 줬어요</button>
          <button className="button secondary" onClick={() => begin(cycle,'MOIST',task)}>아직 촉촉해요</button>
          <button className="button secondary" onClick={() => begin(cycle,'SNOOZED',task)}>나중에</button>
          {task.status === 'SNOOZED' && <button className="button secondary" onClick={() => begin(cycle,'UNSNOOZE',task)}>연기 취소</button>}
        </div>
      </article>;
    })}
    {!week && open.length > 3 && <button className="button secondary" onClick={() => setAll(!all)}>{all ? '주요 작업 3개만 보기' : `작업 모두 보기 (${open.length}개)`}</button>}
    {cycles.filter(c => c.status === 'ACTIVE' && c.recordStatus === 'ACTIVE').map(cycle => <div className="space-section" key={cycle.id}>
      <h3>{plantings.find(p => p.id === cycle.plantingId)?.displayName} · 관리 설정</h3>
      <p>마지막 실제 급수: {lastWatered(data.events.filter(e => e.cycleId === cycle.id)) ?? '기록 없음'}</p>
      <button className="button secondary" onClick={() => begin(cycle,'RULE')}>사용자 확인 간격 설정</button>
      <div className="button-row"><button className="button secondary" onClick={() => begin(cycle,'WATERED')}>실제 물주기 직접 기록</button><button className="button secondary" onClick={() => begin(cycle,'MOIST')}>촉촉함 직접 관찰 기록</button></div>
    </div>)}
    <details className="space-section"><summary>실제 관리 기록 이력</summary>
      {[...data.events.map(e => ({...e,type:'CARE_EVENT' as const,label:'물주기'})),...data.observations.map(e => ({...e,type:'OBSERVATION' as const,label:'촉촉함 관찰'}))].filter(e => cycles.some(c => c.id === e.cycleId)).sort((a,b) => b.occurredAt.localeCompare(a.occurredAt)).map(row => {
        const cycle = cycles.find(c => c.id === row.cycleId)!;
        const task = data.tasks.find(t => t.resolutionId === row.id);
        const valid = row.type === 'CARE_EVENT' ? effective(data.events.filter(e => e.cycleId === cycle.id)).some(e => e.id === row.id) : effective(data.observations.filter(e => e.cycleId === cycle.id)).some(e => e.id === row.id);
        return <div className="card space-section" key={row.id}><p>{row.label} · {row.occurredAt} · {valid ? '유효' : '정정/취소됨'}</p>
          {valid && cycle.status === 'ACTIVE' && <div className="button-row"><button className="button secondary" onClick={() => begin(cycle,'UNDO',task,{targetId:row.id,targetType:row.type})}>되돌리기</button><button className="button secondary" onClick={() => begin(cycle,'CORRECT',task,{targetId:row.id,targetType:row.type,occurredAt:row.occurredAt})}>발생 시각 정정</button></div>}
        </div>;
      })}
    </details>
    {draft && <ModalDialog labelledBy="care-dialog-title" onClose={() => {if (!busy) setDraft(null);}}>
      <h2 id="care-dialog-title">{draft.kind === 'RULE' ? '사용자 확인 간격 설정' : '관리 기록 확인'}</h2>
      <p role="status">{busy ? '저장 중' : error ? '저장 실패 · 재시도 가능' : '미저장'}</p>
      {error && <p role="alert">{error}</p>}
      <form onSubmit={e => {e.preventDefault(); void save();}}>
        <label className="form-field">발생 시각 (이 기기의 현지 시간)<input type="datetime-local" step="1" required value={localTimestampInput(draft.occurredAt)} disabled={busy} onChange={e => {
          const date = new Date(e.target.value);
          setDraft({...draft,occurredAt:Number.isFinite(date.getTime()) ? date.toISOString() : ''});
        }}/></label>
        <p className="field-hint">입력 시간대: {Intl.DateTimeFormat().resolvedOptions().timeZone}. 확인 일정은 시즌의 재배지 시간대로 계산합니다.</p>
        {draft.kind === 'RULE' && <label className="form-field">토양 확인 간격 (일, 1~30)<input type="number" min="1" max="30" required value={draft.inspectionDays} disabled={busy} onChange={e => setDraft({...draft,inspectionDays:Number(e.target.value)})}/></label>}
        {draft.kind === 'SNOOZED' && <label className="form-field">다시 확인할 날짜<input type="date" required value={draft.dueLocalDate} disabled={busy} onChange={e => setDraft({...draft,dueLocalDate:e.target.value})}/></label>}
        <p>물주기와 촉촉함 관찰은 서로 다른 기록입니다. 되돌리기는 원본을 보존합니다.</p>
        <div className="button-row"><button className="button" disabled={busy}>{error ? '다시 시도' : '확인하고 저장'}</button><button type="button" className="button secondary" disabled={busy} onClick={() => setDraft(null)}>취소</button>
        {error && <button type="button" className="button secondary" onClick={() => {
          const currentTask = data.tasks.find(t => t.id === draft.taskId), currentCycle = data.cycles.find(c => c.id === draft.cycleId);
          setDraft({...draft,expectedRevision:currentTask?.revision ?? currentCycle?.revision ?? draft.expectedRevision});
          setMessage('최신 상태 반영 · 입력과 키 유지');
        }}>최신 상태 반영</button>}</div>
      </form>
    </ModalDialog>}
  </section>;
}
