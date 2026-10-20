import { ValidationError } from '../db/errors';
export interface ProcessedPhoto { state: 'READY'; display: Blob; thumbnail: Blob }
export type PhotoState = 'SELECTED' | 'PROCESSING' | 'READY' | 'FAILED';
const invalid = () => new ValidationError('사진을 처리하지 못했어요. JPEG·PNG·WebP(10MiB, 24MP, 한 변 8192px 이하)를 다시 선택해 주세요.');
const signature = [137,80,78,71,13,10,26,10];
const text = (b: Uint8Array, start: number, end: number) => String.fromCharCode(...b.slice(start,end));
export async function hashBlob(blob: Blob): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), n => n.toString(16).padStart(2,'0')).join('');
}
// Keep original CRCs of critical chunks. No EXIF, XMP, text or location-bearing ancillary chunks survive.
export function stripPngMetadata(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (!signature.every((v,i) => bytes[i] === v)) throw invalid();
  const chunks = [bytes.slice(0,8)]; let offset = 8, ended = false, header = false, data = false;
  while (offset + 12 <= bytes.length) {
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
    if (length > bytes.length - offset - 12) throw invalid();
    const kind = text(bytes,offset+4,offset+8);
    if (offset === 8 && (kind !== 'IHDR' || length !== 13)) throw invalid();
    if (kind === 'IHDR') { if (header) throw invalid(); header = true; }
    if (kind === 'IDAT') data = true;
    if (['IHDR','PLTE','IDAT','IEND'].includes(kind)) chunks.push(bytes.slice(offset,offset+12+length));
    offset += length + 12;
    if (kind === 'IEND') { ended = true; break; }
  }
  if (!ended || !header || !data || offset !== bytes.length) throw invalid();
  const result = new Uint8Array(chunks.reduce((n,b) => n + b.length,0)); let at = 0;
  for (const chunk of chunks) { result.set(chunk,at); at += chunk.length; }
  return result;
}
function dimensions(bytes: Uint8Array, kind: string): [number,number] {
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if (kind === 'png' && bytes.length >= 24) return [view.getUint32(16),view.getUint32(20)];
  if (kind === 'jpeg') {
    let at = 2;
    while (at + 8 < bytes.length) {
      if (bytes[at++] !== 255) throw invalid();
      while (bytes[at] === 255) at++;
      const marker = bytes[at++];
      if (marker === 218 || marker === 217) break;
      const length = view.getUint16(at);
      if (length < 2 || at + length > bytes.length) throw invalid();
      if ([192,193,194].includes(marker)) return [view.getUint16(at+5),view.getUint16(at+3)];
      at += length;
    }
  }
  if (kind === 'webp' && bytes.length >= 30) {
    const chunk = text(bytes,12,16);
    if (chunk === 'VP8X') return [1+bytes[24]+(bytes[25]<<8)+(bytes[26]<<16),1+bytes[27]+(bytes[28]<<8)+(bytes[29]<<16)];
    if (chunk === 'VP8 ') return [view.getUint16(26,true)&16383,view.getUint16(28,true)&16383];
    if (chunk === 'VP8L' && bytes[20] === 47) return [1+bytes[21]+((bytes[22]&63)<<8),1+(bytes[22]>>6)+(bytes[23]<<2)+((bytes[24]&15)<<10)];
  }
  throw invalid();
}
function checkSize(width: number,height: number) {
  if (width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 24_000_000) throw invalid();
}
export async function processPhoto(file: File, signal?: AbortSignal): Promise<ProcessedPhoto> {
  signal?.throwIfAborted();
  if (file.size > 10 * 1024 * 1024 || file.size < 12) throw invalid();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = signature.every((v,i) => bytes[i] === v) ? 'png' : bytes[0] === 255 && bytes[1] === 216 ? 'jpeg' : text(bytes,0,4) === 'RIFF' && text(bytes,8,12) === 'WEBP' ? 'webp' : '';
  const extensions: Record<string, RegExp> = { png: /\.png$/i, jpeg: /\.jpe?g$/i, webp: /\.webp$/i };
  if (!kind || file.type !== `image/${kind}` || !extensions[kind].test(file.name)) throw invalid();
  checkSize(...dimensions(bytes,kind));
  signal?.throwIfAborted();
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    checkSize(bitmap.width,bitmap.height); signal?.throwIfAborted();
    async function render(limit: number) {
      const ratio = Math.min(1,limit / Math.max(bitmap.width,bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1,Math.round(bitmap.width*ratio)); canvas.height = Math.max(1,Math.round(bitmap.height*ratio));
      const ctx = canvas.getContext('2d'); if (!ctx) throw invalid();
      ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
      const blob = await new Promise<Blob>((resolve,reject) => canvas.toBlob(b => b ? resolve(b) : reject(invalid()),'image/png'));
      signal?.throwIfAborted();
      return new Blob([stripPngMetadata(new Uint8Array(await blob.arrayBuffer()))], { type: 'image/png' });
    }
    const display = await render(1600), thumbnail = await render(320);
    signal?.throwIfAborted(); return { state: 'READY', display, thumbnail };
  } finally { bitmap.close(); }
}
export async function prepareAttachment(photo: ProcessedPhoto) {
  if (photo.state !== 'READY') throw invalid();
  async function variant(blob: Blob, variant: 'DISPLAY' | 'THUMBNAIL') {
    if (blob.type !== 'image/png' || blob.size > 12 * 1024 * 1024) throw invalid();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const stripped = stripPngMetadata(bytes);
    if (stripped.length !== bytes.length) throw invalid();
    const [width,height] = dimensions(bytes,'png');
    const limit = variant === 'DISPLAY' ? 1600 : 320;
    if (width < 1 || height < 1 || width > limit || height > limit) throw invalid();
    return { variant, blob, sha256: await hashBlob(blob), byteLength: blob.size };
  }
  return { display: await variant(photo.display,'DISPLAY'), thumbnail: await variant(photo.thumbnail,'THUMBNAIL') };
}
