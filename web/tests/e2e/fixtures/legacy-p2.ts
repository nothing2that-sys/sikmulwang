import Dexie from 'dexie';
import { SikmulwangDB,initializeDatabase } from '../../../src/test/fixtures/p2-9df3ef2/database';
import { createPlanting,purgePlanting,updatePlanting } from '../../../src/test/fixtures/p2-9df3ef2/plantingRepository';
import { withWriteTransaction } from '../../../src/test/fixtures/p2-9df3ef2/transaction';
import { SikmulwangDB as NewDB,initializeDatabase as initializeNew } from '../../../src/lib/db/database';
import frozen from '../../../src/test/fixtures/p2-608da74-state.json';
import { processPhoto } from '../../../src/lib/journal/photo';
let db = new SikmulwangDB(); const next = new NewDB();
let epoch = 1, generation = 'g_default';
let release: (()=>void) | undefined, pending: Promise<unknown> | undefined;
const bridge = {
  async process(bytes: number[],type:string,name:string) { const photo=await processPhoto(new File([new Uint8Array(bytes)],name,{ type })); const bitmap=await createImageBitmap(photo.display); const result={ width:bitmap.width,height:bitmap.height,display:Array.from(new Uint8Array(await photo.display.arrayBuffer())),thumbnail:Array.from(new Uint8Array(await photo.thumbnail.arrayBuffer())) }; bitmap.close();return result; },
  async seedFrozen() {
    await db.open(); if(await db.meta.count()) throw new Error('requires isolated empty test DB');
    await db.transaction('rw',db.tables,async()=> { for(const [name,rows] of Object.entries(frozen.stores)) if(rows.length) await db.table(name).bulkAdd(rows); const blob=new Blob([new Uint8Array([0,1,2,255,37,127])],{ type:'image/jpeg' }); await db.mediaBlobs.add({ generationId:'g_default',id:'original-protected',mediaId:'original-protected',variant:'ORIGINAL',blob,sha256:'legacy-preserved',byteLength:blob.size }); });
    return bridge.initialize();
  },
  async initialize() { const meta=await initializeDatabase(db); epoch=meta.epoch; generation=meta.activeGenerationId; return meta; },
  seed() { return createPlanting(db,epoch,generation,{ displayName:'구 P2 합성 식물',locationId:'loc_indoor_living',groupType:'INDIVIDUAL',quantity:1,startLocalDate:'2026-01-01' }); },
  purge(id:string,revision:number) { return purgePlanting(db,epoch,generation,id,revision); },
  edit(id:string,revision:number) { return updatePlanting(db,epoch,generation,id,{ displayName:'old update',expectedRevision:revision }); },
  isOpen() { return db.isOpen(); },
  reopen() { db.close(); db=new SikmulwangDB(); return bridge.initialize(); },
  async dump() { const state: Record<string,unknown[]> = {}; for(const table of db.tables) state[table.name]=await table.toArray(); state.mediaBlobs=await Promise.all((await db.mediaBlobs.toArray()).map(async row=>({ ...row,blob:Array.from(new Uint8Array(await row.blob.arrayBuffer())) }))); return state; },
  async holdOld(id:string) {
    let enter!:()=>void; const entered=new Promise<void>(r=>enter=r),gate=new Promise<void>(r=>release=r);
    pending=withWriteTransaction(db,[db.plantings],epoch,generation,async()=> { const row=await db.plantings.get([generation,id]); enter(); await Dexie.waitFor(gate); await db.plantings.put({ ...row!,displayName:'P2 lock first',revision:row!.revision+1 }); });
    await entered;
  },
  async holdNew() {
    await next.open(); let enter!:()=>void; const entered=new Promise<void>(r=>enter=r),gate=new Promise<void>(r=>release=r);
    pending=next.transaction('rw',next.tables,async()=> { const meta=await initializeNew(next); enter(); await Dexie.waitFor(gate); return meta; });
    await entered;
  },
  async release() { release?.(); return pending; },
};
declare global { interface Window { legacyP2: typeof bridge } }
window.legacyP2=bridge;
