import { useEffect,useState,useRef } from 'react';
import { liveQuery } from 'dexie';
import { useDb } from '../../lib/db/DbContext';
import { ConfirmDialog } from '../../components/common/ConfirmDialog';
import { exportBackup,stageBackup,activateBackup,sealBackup,cancelBackup,listBackupJobs,archivedGardens,activateArchived,type BackupJob } from '../../lib/backup/repository';
import type { GenerationRecord,ProfileRecord } from '../../lib/db/types';

export function BackupPanel(){
  const {db,meta,isReady,refresh}=useDb();
  const [jobs,setJobs]=useState<BackupJob[]>([]),[gardens,setGardens]=useState<GenerationRecord[]>([]),[profiles,setProfiles]=useState<ProfileRecord[]>([]);
  const [file,setFile]=useState<File|null>(null),[output,setOutput]=useState<{blob:Blob;backupId:string}|null>(null),[url,setUrl]=useState('');
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[confirm,setConfirm]=useState<{kind:'RESTORE'|'ARCHIVE';id:string}|null>(null);
  const running=useRef(false);
  const controller=useRef<AbortController|null>(null);
  useEffect(()=>{const sub=liveQuery(async()=>({ jobs:await listBackupJobs(db),gardens:await archivedGardens(db),profiles:await db.profiles.toArray() })).subscribe({ next:value=>{setJobs(value.jobs);setGardens(value.gardens);setProfiles(value.profiles);},error:()=>setError('백업 작업 상태를 읽지 못했어요. 기존 정원은 보존됩니다.') });return()=>sub.unsubscribe();},[db]);
  useEffect(()=>{if(!output)return;const next=URL.createObjectURL(output.blob);let alive=true;queueMicrotask(()=>{if(alive)setUrl(next);});return()=>{alive=false;URL.revokeObjectURL(next);};},[output]);
  useEffect(()=>()=>controller.current?.abort(),[]);
  async function run(action:(signal:AbortSignal)=>Promise<void>){
    if(running.current)return;running.current=true;const next=new AbortController();controller.current=next;setBusy(true);setError('');setMessage('검증·처리 중이에요. 완료 전 창을 닫으면 작업 상태가 남을 수 있어요.');
    try{await action(next.signal);}catch(e){setError(next.signal.aborted?'작업을 취소했어요. 기존 정원은 보존됩니다.':e instanceof Error?e.message:'작업에 실패했어요. 기존 정원은 보존됩니다.');setMessage('실패·취소는 백업 또는 복원 완료가 아닙니다.');}finally{running.current=false;setBusy(false);}
  }
  const currentSession=()=>{if(!meta)throw new Error('저장소 준비를 기다려 주세요.');return {epoch:meta.epoch,generation:meta.activeGenerationId};};
  return <section className="card backup-panel"><h2>백업 및 복원</h2>
    <p>일기·초안·사진·휴지통·관리 이력을 이 기기의 ZIP 파일로 보관하세요. 서버나 Google Drive로 전송하지 않습니다.</p>
    <p className="field-hint">현재 선택한 정원 전체를 백업합니다. ZIP 파일은 암호화되지 않으므로 안전한 곳에 보관하세요. 최대 해제 데이터 256MiB, ZIP 300MiB, 사진당 32MiB 범위이며 모든 기기의 성공을 보장하지 않습니다.</p>
    <div className="planned-actions"><button className="button" type="button" disabled={!isReady||!meta||busy} onClick={()=>void run(async signal=>{const result=await exportBackup(db,currentSession(),signal);setOutput(result);setMessage('파일 생성과 재읽기 검증이 완료됐어요. ZIP 내려받기를 눌러 보관하세요. 실제 파일 저장 여부는 확인되지 않았습니다.');})}>ZIP 백업 만들기</button>
    {output&&url&&<a className="button secondary" href={url} download={`sikmulwang-${output.backupId}.zip`}>ZIP 내려받기</a>}
    <label className="backup-file">백업 ZIP 선택<input type="file" accept=".zip,application/zip" disabled={busy||!isReady} onChange={e=>{setFile(e.target.files?.[0]||null);setError('');setMessage('선택한 파일은 아직 복원되지 않았어요. 검증 후 새 정원으로 가져오기를 눌러 주세요.');}} /></label>
    <button className="button secondary" type="button" disabled={!file||busy||!isReady} onClick={()=>void run(async signal=>{const current=await stageBackup(db,currentSession(),file!,signal);setMessage(`새 정원 준비와 검증이 끝났어요. 기존 정원은 유지 중입니다. 아래 복원 작업에서 내용을 확인하고 전환하세요. 작업 ${current.id.slice(0,8)}`);})}>검증 후 새 정원으로 가져오기</button>
    {busy&&<button className="button secondary" type="button" onClick={()=>controller.current?.abort()}>현재 작업 취소</button>}
    </div><p role="status">{message}</p>{error&&<p role="alert">{error}</p>}
    <p className="field-hint">가져오기는 기존 정원을 덮어쓰지 않습니다. 작업 중 기존 정원을 수정하면 그 수정은 보관되는 원본 정원에 남고 복원 정원에 합쳐지지 않습니다. 복원 전 ZIP과 기존 변경 사항을 확인하세요.</p>
    <div role="region" aria-label="백업 복원 작업 목록">{[...jobs.filter(j=>['EXPORTING','STAGING','SEALING','READY'].includes(j.state)),...jobs.filter(j=>!['EXPORTING','STAGING','SEALING','READY'].includes(j.state)).slice(0,20)].map(job=><article key={job.id} className="backup-job"><h3>{job.kind==='EXPORT'?'내보내기':'새 정원 복원'} · {job.state}</h3><p>{job.createdAt} · 처리한 항목 {job.progress}</p>
      {job.counts&&<p>식물 {job.counts.plantings} · 일기 {job.counts.diaries} · 사진 {job.counts.media} · 보관 파일 {job.counts.mediaBlobs}</p>}
      {job.profileId&&<p>새 프로필: {profiles.find(p=>p.profileId===job.profileId)?.name}</p>}
      {['SEALING','STAGING'].includes(job.state)&&<button type="button" className="button secondary" disabled={busy} onClick={()=>void run(async signal=>{await sealBackup(db,job.id,signal);setMessage('중단된 복원 데이터를 다시 검증했어요. 내용을 확인하고 정원을 전환하세요.');})}>중단 데이터 다시 검증</button>}
      {job.state==='READY'&&<button type="button" className="button" disabled={busy} onClick={()=>setConfirm({kind:'RESTORE',id:job.id})}>복원 정원으로 전환</button>}
      {['EXPORTING','STAGING','SEALING','READY'].includes(job.state)&&<><p>중단 후 다시 열었다면 파일을 다시 선택해 재시도하거나 이 작업을 취소하세요. 기존 정원은 삭제하지 않습니다.</p><button type="button" className="button secondary" disabled={busy} onClick={()=>void run(async()=>{await cancelBackup(db,job.id);setMessage('이 작업을 취소했어요. 원본과 남은 스테이징 데이터는 보존됩니다.');})}>이 작업 취소·잠금 해제</button></>}
    </article>)}</div>
    {gardens.length>0&&<div><h3>보존된 이전 정원</h3><p>전환 전 원본과 당시 변경을 보관하고 있어요. 삭제하지 않고 다시 열 수 있습니다.</p>{gardens.map(g=><div key={g.generationId}><p>{profiles.find(p=>p.profileId===g.profileId)?.name} · {g.updatedAt}</p><button type="button" className="button secondary" disabled={busy} onClick={()=>setConfirm({kind:'ARCHIVE',id:g.generationId})}>이 보관 정원 열기</button></div>)}</div>}
    <ConfirmDialog open={!!confirm} title="원본을 보존하고 정원을 전환할까요?" confirmLabel="원본 보존하고 전환" onCancel={()=>setConfirm(null)} onConfirm={()=>{const target=confirm;setConfirm(null);if(target)void run(async signal=>{if(target.kind==='RESTORE')await activateBackup(db,target.id,signal);else await activateArchived(db,currentSession(),target.id,signal);await refresh();setMessage('정원을 전환했어요. 이전 정원은 보존되어 있으며 다른 탭의 오래된 저장은 거부됩니다.');});}}><p>현재 정원을 보관하고 선택한 정원으로 전환합니다. 기존 기록을 합치거나 덮어쓰지 않습니다.</p></ConfirmDialog>
  </section>;
}
