import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { useDb } from '../../lib/db/DbContext';
import type { CycleRecord, DiaryRecord, MediaBlobRecord, MediaLinkRecord, CareEventRecord, ObservationRecord } from '../../lib/db/types';
export function useJournalData() {
  const context = useDb();
  const { db, meta } = context;
  const [data,setData] = useState<{ generation: string; cycles: CycleRecord[]; entries: DiaryRecord[]; links: MediaLinkRecord[]; blobs: MediaBlobRecord[]; care: CareEventRecord[]; observations: ObservationRecord[] }>({ generation: '', cycles: [], entries: [], links: [], blobs: [], care: [], observations: [] });
  const [error,setError] = useState('');
  useEffect(() => {
    if (!meta) return;
    const generation = meta.activeGenerationId;
    const sub = liveQuery(async () => {
      const [cycles,entries,links,blobs,care,observations] = await Promise.all([db.cycles,db.diaries,db.mediaLinks,db.mediaBlobs,db.careEvents,db.observations].map(table => table.where('generationId').equals(generation).toArray()));
      return { generation,cycles,entries,links,blobs,care,observations } as typeof data;
    }).subscribe({ next: setData, error: () => setError('일기 목록을 읽지 못했어요. 새로고침 후 다시 확인해 주세요.') });
    return () => sub.unsubscribe();
  },[db,meta]);
  const visible = data.generation === meta?.activeGenerationId ? data : { cycles: [],entries: [],links: [],blobs: [],care: [],observations: [] };
  return { ...context, ...visible, readError: error };
}
export function PhotoPreview({ blob, alt }: { blob: Blob; alt: string }) {
  const [url,setUrl] = useState('');
  useEffect(() => { const next = URL.createObjectURL(blob); let active = true; queueMicrotask(() => { if (active) setUrl(next); }); return () => { active = false; URL.revokeObjectURL(next); }; },[blob]);
  return url ? <img className="journal-photo" src={url} alt={alt} /> : null;
}
