import Dexie from 'dexie';
import type { SikmulwangDB } from '../db/database';
import { withWriteTransaction } from '../db/transaction';
import { ConflictError, ValidationError, NotFoundError } from '../db/errors';
import { validateLocalDate } from '../db/validators';
import type { DiaryRecord, JournalEntry, JournalMeta, JournalMedia } from '../db/types';
import { canonical } from '../care/engine';
import { prepareAttachment, type ProcessedPhoto } from './photo';

export const isJournalEntry = (row: DiaryRecord): row is JournalEntry => row.journalVersion === 1;
export interface EntryInput {
  id: string; expectedRevision: number; cycleId: string; entryLocalDate: string;
  title: string; body: string; tags: string[]; draftState: 'DRAFT' | 'PUBLISHED';
  writeId: string;
}
type SavedEntry = JournalEntry & { lastWriteId?: string; lastRequest?: string };
export function journalMeta(now: string): JournalMeta {
  return { journalVersion: 1, createdAt: now, updatedAt: now, revision: 1, schemaVersion: 1, recordStatus: 'ACTIVE' };
}
function checkRevision(row: JournalEntry, expected: number) {
  if (row.revision !== expected) throw new ConflictError('다른 탭에서 변경됐어요. 현재 입력을 별도 초안으로 보존하거나 저장본을 다시 불러오세요.', row.revision, expected);
}
export async function saveEntry(db: SikmulwangDB, epoch: number, generation: string, input: EntryInput): Promise<JournalEntry> {
  validateLocalDate(input.entryLocalDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.entryLocalDate) || !input.id || !input.writeId || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 ||
      typeof input.title !== 'string' || input.title.length > 100 || typeof input.body !== 'string' || input.body.length > 2000 ||
      !Array.isArray(input.tags) || input.tags.length > 10 || input.tags.some(t => typeof t !== 'string' || !t.trim() || t.length > 30) ||
      !['DRAFT', 'PUBLISHED'].includes(input.draftState)) throw new ValidationError('일기 입력을 확인해 주세요.');
  const request = canonical(input);
  return withWriteTransaction(db, [db.diaries, db.cycles, db.plantings], epoch, generation, async ({ generationId, nowUtc }) => {
    const existing = await db.diaries.get([generationId, input.id]) as SavedEntry | undefined;
    if (existing && !isJournalEntry(existing)) throw new ValidationError('이전 형식 기록은 원본을 보존하며 편집하지 않습니다.');
    if (existing?.lastWriteId === input.writeId) {
      if (existing.lastRequest !== request) throw new ValidationError('동일 요청 키의 내용이 달라졌어요.');
      return existing;
    }
    if (existing) { checkRevision(existing, input.expectedRevision); if (existing.recordStatus !== 'ACTIVE') throw new ValidationError('휴지통에서 먼저 복원해 주세요.'); }
    else if (input.expectedRevision !== 0) throw new NotFoundError('일기를 찾을 수 없어요.');
    const cycle = await db.cycles.get([generationId, input.cycleId]);
    const planting = cycle && await db.plantings.get([generationId, cycle.plantingId]);
    if (!cycle || cycle.recordStatus !== 'ACTIVE' || !planting || planting.recordStatus !== 'ACTIVE') throw new ValidationError('사용 가능한 식물과 시즌을 선택해 주세요.');
    if (input.entryLocalDate < cycle.startLocalDate || (cycle.endLocalDate && input.entryLocalDate > cycle.endLocalDate)) throw new ValidationError('시즌 기간 안의 날짜를 선택해 주세요.');
    if (existing && existing.cycleId !== input.cycleId) throw new ValidationError('저장된 일기의 시즌은 변경할 수 없어요. 새 초안으로 작성해 주세요.');
    const row: SavedEntry = {
      ...journalMeta(nowUtc), ...existing, generationId, id: input.id, cycleId: input.cycleId,
      timeZone: cycle.timeZone, entryLocalDate: input.entryLocalDate, title: input.title || null, body: input.body,
      tags: [...new Set(input.tags.map(t => t.trim()))], draftState: input.draftState,
      updatedAt: nowUtc, revision: (existing?.revision ?? 0) + 1, lastWriteId: input.writeId, lastRequest: request,
    };
    await db.diaries.put(row); return row;
  });
}
export async function setEntryTrash(db: SikmulwangDB, epoch: number, generation: string, id: string, revision: number, trashed: boolean) {
  return withWriteTransaction(db, [db.diaries, db.cycles, db.plantings], epoch, generation, async ({ generationId, nowUtc }) => {
    const row = await db.diaries.get([generationId, id]);
    if (!row || !isJournalEntry(row)) throw new NotFoundError('편집 가능한 일기를 찾을 수 없어요.');
    checkRevision(row, revision);
    // Preserve even when parent is trashed. Restoration never mutates the parent.
    const updated: JournalEntry = { ...row, recordStatus: trashed ? 'TRASHED' : 'ACTIVE', updatedAt: nowUtc, revision: row.revision + 1 };
    await db.diaries.put(updated); return updated;
  });
}
export async function attachPhoto(db: SikmulwangDB, epoch: number, generation: string, diaryId: string, revision: number, photo: ProcessedPhoto, signal?: AbortSignal) {
  // All byte hashing precedes the write transaction; no decode/resize inside IDB.
  const ready = await prepareAttachment(photo);
  signal?.throwIfAborted();
  return withWriteTransaction(db, [db.diaries, db.media, db.mediaBlobs, db.mediaLinks], epoch, generation, async ({ generationId, nowUtc }) => {
    signal?.throwIfAborted();
    const transaction = Dexie.currentTransaction!;
    const abort = () => transaction.abort();
    const cleanup = () => signal?.removeEventListener('abort',abort);
    signal?.addEventListener('abort',abort,{ once: true });
    transaction.on('complete',cleanup); transaction.on('abort',cleanup);
    const diary = await db.diaries.get([generationId, diaryId]);
    if (!diary || !isJournalEntry(diary) || diary.recordStatus !== 'ACTIVE') throw new ValidationError('저장된 초안에만 사진을 첨부할 수 있어요.');
    const mediaId = `photo_${ready.display.sha256}`;
    const linkId = `${diaryId}:${mediaId}`;
    const link = await db.mediaLinks.get([generationId, linkId]);
    checkRevision(diary, revision);
    const alreadyLinked = link?.recordStatus === 'ACTIVE';
    const links = await db.mediaLinks.where('generationId').equals(generationId).filter(l => l.ownerType === 'DIARY' && l.ownerId === diaryId && l.recordStatus !== 'TRASHED').toArray();
    if (!alreadyLinked && links.length >= 6) throw new ValidationError('사진은 일기당 6장까지 첨부할 수 있어요.');
    const existing = await db.media.get([generationId, mediaId]);
    if (existing) {
      if (existing.journalVersion !== 1 || existing.sha256 !== ready.display.sha256 || existing.privacyState !== 'STRIPPED') throw new ValidationError('기존 사진 메타데이터를 확인할 수 없어요.');
      const blobs = await db.mediaBlobs.where('generationId').equals(generationId).filter(b => b.mediaId === mediaId).toArray();
      if (blobs.length !== 2) throw new ValidationError('기존 사진 bytes를 확인할 수 없어요.');
      for (const item of [ready.display, ready.thumbnail]) {
        const stored = blobs.find(b => b.variant === item.variant);
        if (!stored || stored.sha256 !== item.sha256 || stored.byteLength !== item.byteLength || stored.blob.size !== item.byteLength ||
            await Dexie.waitFor(prepareAttachmentHash(stored.blob)) !== item.sha256) throw new ValidationError('기존 사진 bytes가 일치하지 않아요. 원본은 보존됩니다.');
      }
    } else {
      const media: JournalMedia = { ...journalMeta(nowUtc), generationId, id: mediaId, mimeType: 'image/png', byteLength: ready.display.byteLength, sha256: ready.display.sha256, capturedAt: null, capturedLocalDate: null, privacyState: 'STRIPPED', variants: ['DISPLAY','THUMBNAIL'], processingState: 'READY' };
      await db.media.add(media);
      for (const item of [ready.display, ready.thumbnail]) await db.mediaBlobs.add({ ...journalMeta(nowUtc), generationId, id: `${mediaId}:${item.variant}`, mediaId, ...item });
    }
    signal?.throwIfAborted();
    if (alreadyLinked && !diary.photoRecovery) return diary;
    if (!alreadyLinked) await db.mediaLinks.put({ ...journalMeta(nowUtc), ...link, generationId, id: linkId, ownerType: 'DIARY', ownerId: diaryId, mediaId, sortOrder: Math.max(-1, ...links.map(l => l.sortOrder)) + 1, recordStatus: 'ACTIVE', updatedAt: nowUtc, revision: (link?.revision ?? 0) + 1 });
    const updated: JournalEntry = { ...diary, photoRecovery: null, updatedAt: nowUtc, revision: diary.revision + 1 };
    await db.diaries.put(updated); signal?.throwIfAborted(); return updated;
  });
}
import { hashBlob as prepareAttachmentHash } from './photo';
export async function setPhotoTrash(db: SikmulwangDB, epoch: number, generation: string, diaryId: string, revision: number, linkId: string, trashed: boolean) {
  return withWriteTransaction(db, [db.diaries, db.mediaLinks], epoch, generation, async ({ generationId, nowUtc }) => {
    const diary = await db.diaries.get([generationId, diaryId]);
    const link = await db.mediaLinks.get([generationId, linkId]);
    if (!diary || !isJournalEntry(diary) || diary.recordStatus !== 'ACTIVE' || !link || link.ownerType !== 'DIARY' || link.ownerId !== diaryId) throw new ValidationError('일기 사진을 찾을 수 없어요.');
    checkRevision(diary, revision);
    const links = await db.mediaLinks.where('generationId').equals(generationId).filter(l => l.ownerType === 'DIARY' && l.ownerId === diaryId && l.recordStatus !== 'TRASHED').toArray();
    if (!trashed && links.length >= 6) throw new ValidationError('사진은 6장까지 복원할 수 있어요.');
    await db.mediaLinks.put({ ...link, recordStatus: trashed ? 'TRASHED' : 'ACTIVE', updatedAt: nowUtc, revision: (link.revision ?? 0) + 1 });
    const updated: JournalEntry = { ...diary, updatedAt: nowUtc, revision: diary.revision + 1 };
    await db.diaries.put(updated); return updated;
  });
}

// Persist only a recovery marker, never the source file or its identifying metadata.
export async function markPhotoRecovery(db: SikmulwangDB, epoch: number, generation: string, id: string, revision: number, pending: boolean) {
  return withWriteTransaction(db,[db.diaries],epoch,generation,async({ generationId,nowUtc })=> {
    const row=await db.diaries.get([generationId,id]);
    if(!row || !isJournalEntry(row) || row.recordStatus !== 'ACTIVE') throw new ValidationError('사진 작업을 위한 초안을 찾을 수 없어요.');
    checkRevision(row,revision);
    const marker=pending ? 'RESELECT_REQUIRED' : null;
    if((row.photoRecovery ?? null) === marker) return row;
    const updated: JournalEntry={ ...row,photoRecovery:marker,updatedAt:nowUtc,revision:row.revision+1 };
    await db.diaries.put(updated);return updated;
  });
}
