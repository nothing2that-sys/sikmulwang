import { BlobReader, BlobWriter, ZipReader, ZipWriter, type FileEntry } from '@zip.js/zip.js';
import { canonical, sha256 } from '../care/engine';
import { STORES, LIMITS, object, string, integer, fail, jsonBlob, sorted, mediaPath, safeJson, validateDataset, type Dataset, type Row, type Store } from './model';
import { validateEffectiveTimestamp,validateTimeZone } from '../db/validators';
import type { ProfileRecord,GenerationRecord } from '../db/types';
export interface FileDescriptor { path:string; bytes:number; sha256:string; recordCount?:number }
export interface Manifest { format:'sikmulwang-backup-v1'; formatVersion:1; backupId:string; sourceProfileId:string; sourceGenerationId:string; createdAt:string; schemaVersion:1; writerCompatibility:3; algorithmVersion:'rules-v1'; sourceTimeZone:string; entityCounts:Record<Store,number>; fileEntries:FileDescriptor[]; snapshotDigest:string; complete:true }
export interface Archive { manifest:Manifest; data:Dataset }
export const storePath=(name:Store)=>`data/${name.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())}.json`;
export const metadataPaths=['data/profiles.json','data/generation.json',...STORES.map(storePath)];
async function digest(manifest:Omit<Manifest,'snapshotDigest'|'complete'>|Manifest) { const { snapshotDigest: _digest,complete: _complete,...body }=manifest as Manifest; void _digest;void _complete;return sha256(canonical(body)); }
async function hashFile(blob:Blob) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),n=>n.toString(16).padStart(2,'0')).join(''); }
export async function createArchive(data:Dataset,signal?:AbortSignal):Promise<{ blob:Blob;manifest:Manifest }> {
  await validateDataset(data,signal);
  const files: { path:string;blob:Blob;recordCount?:number }[]=[{ path:metadataPaths[0],blob:jsonBlob([data.profile]),recordCount:1 },{ path:metadataPaths[1],blob:jsonBlob([data.generation]),recordCount:1 }];
  for(const name of STORES){ const blob=jsonBlob(sorted(data.stores[name]));if(blob.size>LIMITS.json)fail('백업 JSON이 8MiB 한도를 넘어요. 원본은 보존됩니다.');files.push({ path:storePath(name),blob,recordCount:data.stores[name].length }); }
  for(const row of data.stores.mediaBlobs){const media=data.stores.media.find(m=>m.id===row.mediaId)!;files.push({path:mediaPath(row,media),blob:data.blobs.get(row.id)!});}
  if(files.filter(f=>f.path.startsWith('data/')).reduce((n,f)=>n+f.blob.size,0)>LIMITS.metadata)fail('백업 JSON 합계가 32MiB 한도를 넘어요.');
  if(files.length+1>LIMITS.entries||files.reduce((sum,f)=>sum+f.blob.size,0)>LIMITS.total)fail('백업이 현재 용량·항목 한도를 넘어요. 원본은 보존됩니다.');
  files.sort((a,b)=>a.path<b.path?-1:1);
  const fileEntries:FileDescriptor[]=[];
  for(const f of files){signal?.throwIfAborted();fileEntries.push({path:f.path,bytes:f.blob.size,sha256:await hashFile(f.blob),...(f.recordCount!==undefined?{recordCount:f.recordCount}:{})});}
  const body:Omit<Manifest,'snapshotDigest'|'complete'>={format:'sikmulwang-backup-v1',formatVersion:1,backupId:crypto.randomUUID(),sourceProfileId:data.profile.profileId,sourceGenerationId:data.generation.generationId,createdAt:new Date().toISOString(),schemaVersion:1,writerCompatibility:3,algorithmVersion:'rules-v1',sourceTimeZone:String(data.stores.userPreferences[0]?.timeZone||'Asia/Seoul'),entityCounts:Object.fromEntries(STORES.map(n=>[n,data.stores[n].length])) as Record<Store,number>,fileEntries};
  const manifest:Manifest={...body,snapshotDigest:await digest(body),complete:true};
  const output=new BlobWriter('application/zip');const writer=new ZipWriter(output,{level:0,useWebWorkers:false});
  try {for(const f of files){signal?.throwIfAborted();await writer.add(f.path,new BlobReader(f.blob),{signal});}await writer.add('manifest.json',new BlobReader(jsonBlob(manifest)),{signal});const blob=await writer.close();if(blob.size>LIMITS.archive)fail();return {blob,manifest};}
  catch(error){await writer.close().catch(()=>{});throw error;}
}
// zip.js reads the directory before yielding entries. Bound any such single allocation.
class BoundedReader extends BlobReader {
  override async readUint8Array(offset:number,length:number):Promise<Uint8Array<ArrayBuffer>> { if(!Number.isSafeInteger(length)||length<0||length>LIMITS.json)fail('ZIP 디렉터리 또는 단일 읽기 한도를 넘어요.');return super.readUint8Array(offset,length) as Promise<Uint8Array<ArrayBuffer>>; }
}
function checkPath(path:string){if(path.length>1024||path.startsWith('/')||path.includes('\\')||path.includes('\0')||path.split('/').some(p=>!p||p==='.'||p==='..')||!(/^(manifest\.json|data\/[a-z-]+\.json|media\/[A-Za-z0-9_%~!()*'.-]+\/(DISPLAY|THUMBNAIL|ORIGINAL)\.(png|jpg|webp))$/).test(path))fail('허용되지 않은 ZIP 경로입니다.');}
async function extract(entry:FileEntry,limit:number,signal?:AbortSignal):Promise<Blob> {
  if(entry.uncompressedSize>limit)fail('ZIP 항목이 크기 한도를 넘어요.');let size=0;const chunks:BlobPart[]=[];
  const sink=new WritableStream<Uint8Array>({write(chunk){signal?.throwIfAborted();size+=chunk.length;if(size>limit||size>entry.uncompressedSize)fail('ZIP 실제 해제 크기가 한도를 넘어요.');chunks.push(new Uint8Array(chunk));}});
  await entry.getData(sink,{signal,checkSignature:true,useWebWorkers:false});if(size!==entry.uncompressedSize)fail('ZIP 실제 길이가 일치하지 않아요.');return new Blob(chunks);
}
export async function readArchive(blob:Blob,signal?:AbortSignal):Promise<Archive> {
  if(blob.size>LIMITS.archive||blob.size<22)fail('ZIP 크기가 지원 범위를 벗어나요. 원본은 보존됩니다.');
  const reader=new ZipReader(new BoundedReader(blob),{strictness:'strict',useWebWorkers:false});
  try {
    const entries=new Map<string,FileEntry>(),names=new Set<string>();let sum=0;
    for await(const entry of reader.getEntriesGenerator()){
      signal?.throwIfAborted();checkPath(entry.filename);const name=entry.filename.toLowerCase();
      if(entries.size>=LIMITS.entries||names.has(name)||entry.directory||entry.encrypted||(entry.externalFileAttributes>>>16&0xf000)===0xa000||![0,8].includes(entry.compressionMethod))fail('중복·암호화·링크·미지원 ZIP 항목입니다.');
      integer(entry.uncompressedSize);integer(entry.compressedSize);sum+=entry.uncompressedSize;
      if(sum>LIMITS.total+LIMITS.json||entry.uncompressedSize>Math.max(1,entry.compressedSize)*LIMITS.ratio)fail('ZIP 해제 크기·압축률 한도를 넘어요.');
      names.add(name);entries.set(entry.filename,entry as FileEntry);
    }
    if(sum-(entries.get('manifest.json')?.uncompressedSize||0)>LIMITS.total||[...entries.values()].filter(e=>e.filename.startsWith('data/')).reduce((n,e)=>n+e.uncompressedSize,0)>LIMITS.metadata)fail('백업 합계 또는 JSON 한도를 넘어요.');
    const me=entries.get('manifest.json');if(!me)fail('manifest가 없는 백업입니다.');const manifest=object(safeJson(await (await extract(me!,LIMITS.json,signal)).text())) as unknown as Manifest;
    if(manifest.format!=='sikmulwang-backup-v1'||manifest.formatVersion!==1||manifest.schemaVersion!==1||manifest.writerCompatibility!==3||manifest.algorithmVersion!=='rules-v1'||manifest.complete!==true)fail('미지원 또는 미래 백업 형식입니다. 파일은 보존됩니다.');
    if(!/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(string(manifest.backupId)))fail();string(manifest.sourceProfileId);string(manifest.sourceGenerationId);validateEffectiveTimestamp(manifest.createdAt);validateTimeZone(manifest.sourceTimeZone);
    object(manifest.entityCounts);if(Object.keys(manifest.entityCounts).length!==STORES.length||Object.keys(manifest.entityCounts).some(key=>!STORES.includes(key as Store)))fail();if(!Array.isArray(manifest.fileEntries)||manifest.fileEntries.length!==entries.size-1||await digest(manifest)!==manifest.snapshotDigest)fail('manifest digest·파일 수가 일치하지 않아요.');
    const listed=new Set<string>();const verified=new Map<string,Blob>();
    for(const descriptor of manifest.fileEntries){object(descriptor);const path=string(descriptor.path);checkPath(path);if(path==='manifest.json'||listed.has(path)||!entries.has(path))fail();listed.add(path);integer(descriptor.bytes);if(!/^[a-f0-9]{64}$/.test(string(descriptor.sha256)))fail();const contents=await extract(entries.get(path)!,path.startsWith('data/')?LIMITS.json:LIMITS.blob,signal);if(contents.size!==descriptor.bytes||await hashFile(contents)!==descriptor.sha256)fail('백업 파일의 길이·해시가 일치하지 않아요.');verified.set(path,contents);}
    for(const path of metadataPaths)if(!listed.has(path))fail('필수 데이터 파일이 누락됐어요.');
    for(const path of metadataPaths.slice(0,2))if(manifest.fileEntries.find(f=>f.path===path)?.recordCount!==1)fail('프로필·세대 건수가 일치하지 않아요.');
    const parse=async(path:string)=>safeJson(await verified.get(path)!.text());
    const profiles=await parse(metadataPaths[0]),generations=await parse(metadataPaths[1]);if(!Array.isArray(profiles)||profiles.length!==1||!Array.isArray(generations)||generations.length!==1)fail();
    const stores={} as Record<Store,Row[]>;
    for(const name of STORES){const rows=await parse(storePath(name));if(!Array.isArray(rows)||rows.length!==manifest.entityCounts[name]||rows.length!==manifest.fileEntries.find(f=>f.path===storePath(name))?.recordCount)fail('데이터 건수가 일치하지 않아요.');stores[name]=rows as Row[];}
    const data:Dataset={profile:object((profiles as unknown[])[0]) as unknown as ProfileRecord,generation:object((generations as unknown[])[0]) as unknown as GenerationRecord,stores,blobs:new Map()};
    if(data.profile.profileId!==manifest.sourceProfileId||data.generation.generationId!==manifest.sourceGenerationId||data.generation.state!=='ACTIVE')fail();
    const expected=new Set(metadataPaths);
    for(const row of stores.mediaBlobs){const media=stores.media.find(m=>m.id===row.mediaId);if(!media)fail();const path=mediaPath(row,media!);expected.add(path);const bytes=verified.get(path);if(!bytes)fail('사진 파일이 누락됐어요.');data.blobs.set(string(row.id),new Blob([bytes!],{type:String(media!.mimeType)}));}
    if(expected.size!==listed.size||[...listed].some(path=>!expected.has(path)))fail('백업에 알 수 없는 파일이 있어요.');
    await validateDataset(data,signal);return {manifest,data};
  } finally {await reader.close();}
}
