import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageContainer, PageHeading } from '../../components/layout/PageContainer';
import { FormField } from '../../components/common/FormField';
import { useDb } from '../../lib/db/DbContext';
import type { CycleRecord, JournalEntry } from '../../lib/db/types';
import { saveEntry, isJournalEntry, attachPhoto, setPhotoTrash, markPhotoRecovery, type EntryInput } from '../../lib/journal/repository';
import { processPhoto, type ProcessedPhoto, type PhotoState } from '../../lib/journal/photo';
import { localDate as zonedDate } from '../../lib/care/engine';
import { useJournalData, PhotoPreview } from './useJournalData';

export function JournalComposePage() {
  const { meta, error, isReady } = useDb();
  const [params,setParams] = useSearchParams();
  const [newId] = useState(() => `diary_${crypto.randomUUID()}`);
  const id = params.get('id') || newId;
  useEffect(() => { if (!params.get('id')) setParams({ id: newId }, { replace: true }); },[params,setParams,newId]);
  if (error) return <p role="alert">저장소를 열지 못했어요. 기존 데이터는 보존됩니다.</p>;
  if (!isReady || !meta) return <p role="status">일기를 준비하고 있어요.</p>;
  return <Editor key={`${meta.activeGenerationId}:${meta.epoch}:${id}`} id={id} epoch={meta.epoch} generation={meta.activeGenerationId} />;
}
function Editor({ id,epoch,generation }: { id: string; epoch: number; generation: string }) {
  const { db,plantings,cycles,links,blobs,readError } = useJournalData();
  const [form,setForm] = useState({ cycleId: '',entryLocalDate: '',title: '',body: '',tags: [] as string[], draftState: 'DRAFT' as 'DRAFT' | 'PUBLISHED' });
  const current = useRef(form);

  const revision = useRef(0), editVersion = useRef(0), blocked = useRef(false), alive = useRef(true);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [hasSaved,setHasSaved] = useState(false);
  const [loaded,setLoaded] = useState(false), [status,setStatus] = useState(''), [failure,setFailure] = useState('');
  const [retryAvailable,setRetryAvailable] = useState(false);
  const [photoState,setPhotoState] = useState<PhotoState | null>(null), [photoError,setPhotoError] = useState('');
  const [readyPhoto,setReadyPhoto] = useState<ProcessedPhoto | null>(null);
  const photoController = useRef<AbortController | null>(null), selectedFile = useRef<File | null>(null);
  const savedVersion = useRef(-1);
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    void db.diaries.get([generation,id]).then(row => {
      if (cancelled) return;
      if (row && (!isJournalEntry(row) || row.recordStatus !== 'ACTIVE')) { blocked.current = true; setFailure('이전 형식 또는 휴지통 기록은 이 화면에서 수정할 수 없어요.'); return; }
      if (row) {
        revision.current = row.revision; setHasSaved(true);
        const restored = { cycleId: row.cycleId, entryLocalDate: row.entryLocalDate, title: row.title || '', body: row.body,tags: row.tags,draftState: row.draftState }; current.current = restored; setForm(restored);
        savedVersion.current = 0; setStatus('저장된 일기를 불러왔어요.');
        if (row.photoRecovery) { setPhotoState('FAILED'); setPhotoError('이전 사진 작업이 완료되지 않았어요. 텍스트 초안은 보존됐으며 사진은 다시 선택해 주세요.'); }
      }
      setLoaded(true);
    }).catch(() => { if (!cancelled) setFailure('일기를 읽지 못했어요. 기존 데이터는 보존됩니다.'); });
    return () => { cancelled = true; alive.current = false; photoController.current?.abort(); };
  },[db,generation,id]);
  function enqueue<T>(action: () => Promise<T>): Promise<T> {
    const next = queue.current.catch(() => {}).then(action); queue.current = next; return next;
  }
  async function persist(snapshot = current.current, version = editVersion.current): Promise<JournalEntry> {
    if (blocked.current) throw new Error('저장 실패를 먼저 해결해 주세요.');
    setHasSaved(true);
    const input: EntryInput = { ...snapshot,id,expectedRevision: revision.current,writeId: crypto.randomUUID() };
    const row = await saveEntry(db,epoch,generation,input);
    revision.current = row.revision; savedVersion.current = version;
    if (alive.current && version === editVersion.current) setStatus(row.draftState === 'DRAFT' ? '초안이 이 기기에 저장됐어요.' : '일기가 이 기기에 저장됐어요.');
    return row;
  }
  function fail(error: unknown) {
    blocked.current = true;
    if (alive.current) { setFailure(error instanceof Error ? error.message : '저장하지 못했어요. 현재 입력은 유지됩니다.'); setStatus('저장 실패 · 현재 입력 유지됨'); }
  }
  useEffect(() => {
    if (!loaded || !form.cycleId || blocked.current || savedVersion.current === editVersion.current) return;
    const version = editVersion.current;
    setStatus('초안 저장 대기 중');
    const timer = setTimeout(() => { void enqueue(async () => { if (version !== editVersion.current || version <= savedVersion.current) return; return persist(form,version); }).catch(fail); },500);
    return () => clearTimeout(timer);
    // The queue owns revision; form changes are the only autosave trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[form,loaded]);
  function change(patch: Partial<typeof form>) { editVersion.current++; setStatus('아직 저장되지 않은 변경이 있어요.'); const next = { ...current.current,...patch }; current.current = next; setForm(next); }
  function selectCycle(cycleId: string) {
    const cycle = cycles.find(c => c.id === cycleId);
    change({ cycleId, entryLocalDate: cycle ? clampDate(zonedDate(new Date().toISOString(),cycle.timeZone),cycle) : '' });
  }
  async function selectPhoto(file: File) {
    photoController.current?.abort();
    const controller = new AbortController(); photoController.current = controller; selectedFile.current = file; setRetryAvailable(true);
    setPhotoState('SELECTED'); setPhotoError(''); setReadyPhoto(null);
    try {
      await enqueue(async () => {
        controller.signal.throwIfAborted();
        if (savedVersion.current !== editVersion.current || !revision.current) await persist();
        controller.signal.throwIfAborted();
        const row = await markPhotoRecovery(db,epoch,generation,id,revision.current,true); revision.current = row.revision;
      });
      controller.signal.throwIfAborted(); setPhotoState('PROCESSING');
      const result = await processPhoto(file,controller.signal);
      controller.signal.throwIfAborted();
      if (!alive.current) return;
      setReadyPhoto(result); setPhotoState('READY');
    } catch {
      if (!controller.signal.aborted && alive.current) { setPhotoState('FAILED'); setPhotoError('사진 처리에 실패했어요. 텍스트 초안은 유지됩니다. 지원 형식·크기를 확인하고 다시 선택해 주세요.'); }
    }
  }
  async function commitPhoto() {
    if (!readyPhoto) return;
    const controller = photoController.current!;
    try {
      await enqueue(async () => {
        controller.signal.throwIfAborted();
        if (savedVersion.current !== editVersion.current || !revision.current) await persist();
        const row = await attachPhoto(db,epoch,generation,id,revision.current,readyPhoto,controller.signal);
        revision.current = row.revision;
      });
      if (alive.current && !controller.signal.aborted) { setReadyPhoto(null); setPhotoState(null); selectedFile.current = null; setPhotoError(''); }
    } catch (e) {
      if (!controller.signal.aborted && alive.current) setPhotoError(e instanceof Error ? e.message : '첨부에 실패했어요. 다시 시도해 주세요.');
    }
  }
  const ownLinks = links.filter(l => l.ownerType === 'DIARY' && l.ownerId === id).sort((a,b) => a.sortOrder - b.sortOrder);
  return <PageContainer><PageHeading eyebrow="기기에 남기는 초록의 하루" title="오늘의 초록 이야기" description="날짜와 글은 자동으로 초안에 저장돼요. 저장 완료 문구를 확인해 주세요." />
    <p>일기와 사진은 서버로 보내지 않습니다. 브라우저 저장소를 지우면 사라질 수 있어요. 백업 기능은 아직 제공하지 않습니다.</p>
    {readError && <p role="alert">{readError}</p>}
    <form className="card compose-form" onSubmit={event => { event.preventDefault(); void enqueue(async () => {
      const snapshot = { ...current.current,draftState: 'PUBLISHED' as const };
      const version = ++editVersion.current; setForm(snapshot); current.current = snapshot;
      await persist(snapshot,version);
    }).catch(fail); }}>
      <fieldset disabled={!loaded}><legend>일기 작성</legend>
      <FormField id="entry-plant" label="식물 및 재배 시즌"><select id="entry-plant" value={form.cycleId} disabled={hasSaved} onChange={e => selectCycle(e.target.value)} required><option value="">시즌 선택</option>{cycles.filter(c => c.recordStatus === 'ACTIVE' && plantings.some(p => p.id === c.plantingId)).map(c => <option key={c.id} value={c.id}>{plantings.find(p => p.id === c.plantingId)?.displayName} · {c.startLocalDate} {c.status === 'ENDED' ? '(종료)' : ''}</option>)}</select></FormField>
      {!cycles.length && <p><Link to="/plants">내 식물에서 식물과 시즌을 먼저 등록해 주세요.</Link></p>}
      <FormField id="entry-date" label="일기 날짜"><input id="entry-date" type="date" required value={form.entryLocalDate} onChange={e => change({ entryLocalDate: e.target.value })} /></FormField>
      <FormField id="entry-title" label="제목 (선택)"><input id="entry-title" maxLength={100} value={form.title} onChange={e => change({ title: e.target.value })} /></FormField>
      <FormField id="entry-body" label="일기 내용"><textarea id="entry-body" rows={6} maxLength={2000} value={form.body} onChange={e => change({ body: e.target.value })} /></FormField>
      <fieldset><legend>태그 (선택)</legend><div className="tag-options">{['새잎','성장','파종','수확'].map(tag => <label key={tag}><input type="checkbox" checked={form.tags.includes(tag)} onChange={e => change({ tags: e.target.checked ? [...form.tags,tag] : form.tags.filter(t => t !== tag) })} />{tag}</label>)}</div></fieldset>
      <p role="status">{status}</p>
      {failure && <div role="alert"><p>{failure}</p><p>현재 입력을 유지하고 있어요. 다시 불러오기는 현재 입력을 바꿉니다.</p><div className="button-row">
        <button type="button" className="button secondary" onClick={() => { blocked.current = false; setFailure(''); void enqueue(() => persist()).catch(fail); }}>저장 다시 시도</button>
        <button type="button" className="button secondary" onClick={() => { const fork = `diary_${crypto.randomUUID()}`; void enqueue(async () => { await saveEntry(db,epoch,generation,{ ...current.current,id: fork,expectedRevision: 0,writeId: crypto.randomUUID(),draftState: 'DRAFT' }); window.location.assign(`/journal/new?id=${fork}`); }).catch(fail); }}>현재 입력을 별도 초안으로 보존</button>
        <button type="button" className="button secondary" onClick={() => { if (window.confirm('현재 입력을 저장본으로 바꿀까요? 보존하려면 취소하고 별도 초안을 만들어 주세요.')) window.location.reload(); }}>저장본 다시 불러오기</button>
      </div></div>}
      <div className="button-row"><button className="button" disabled={!form.cycleId || !!failure}>일기 저장</button><Link className="text-link" to="/journal">일기장으로</Link></div>
      <FormField id="entry-photo" label="사진 첨부" hint="JPEG·PNG·WebP, 장당 10MiB·24MP 이하, 일기당 6장. 위치 정보를 제거한 표시본만 저장합니다."><input id="entry-photo" type="file" accept="image/jpeg,image/png,image/webp" disabled={!form.cycleId} onChange={e => { const file = e.target.files?.[0]; if (file) void selectPhoto(file); e.target.value = ''; }} /></FormField>
      {photoState && <p role="status">사진 상태: {photoState} · 처리 중인 파일은 재진입 시 다시 선택해 주세요.</p>}
      {readyPhoto && <><PhotoPreview blob={readyPhoto.display} alt="첨부 전 사진 미리보기" /><button type="button" className="button" onClick={() => void commitPhoto()}>사진 첨부 저장</button></>}
      {photoState && <button type="button" className="button secondary" onClick={() => { const controller = photoController.current; controller?.abort(); setReadyPhoto(null); setPhotoState(null); setPhotoError(''); selectedFile.current = null; setRetryAvailable(false); void enqueue(async () => { if (photoController.current !== controller || !revision.current) return; const row = await markPhotoRecovery(db,epoch,generation,id,revision.current,false); revision.current = row.revision; }).catch(e => setPhotoError(e instanceof Error ? e.message : '사진 취소 상태를 저장하지 못했어요.'));  }}>사진 선택 취소</button>}
      {photoError && <p role="alert">{photoError}</p>}
      {photoState === 'FAILED' && retryAvailable && <button type="button" className="button secondary" onClick={() => { if (selectedFile.current) void selectPhoto(selectedFile.current); }}>사진 처리 다시 시도</button>}
      <div className="journal-photos">{ownLinks.map(link => { const blob = blobs.find(b => b.mediaId === link.mediaId && b.variant === 'THUMBNAIL'); return <div key={link.id}>{blob && <PhotoPreview blob={blob.blob} alt={link.recordStatus === 'TRASHED' ? '제거된 첨부 사진' : '일기 첨부 사진'} />}<button type="button" className="button secondary" onClick={() => { void enqueue(async () => { const row = await setPhotoTrash(db,epoch,generation,id,revision.current,link.id,link.recordStatus !== 'TRASHED'); revision.current = row.revision; }).catch(e => setPhotoError(e instanceof Error ? e.message : '사진 변경 실패')); }}>{link.recordStatus === 'TRASHED' ? '첨부 복원' : '첨부 제거'}</button></div>; })}</div>
      </fieldset>
    </form></PageContainer>;
}
function clampDate(date: string,cycle: CycleRecord) { return date < cycle.startLocalDate ? cycle.startLocalDate : cycle.endLocalDate && date > cycle.endLocalDate ? cycle.endLocalDate : date; }
