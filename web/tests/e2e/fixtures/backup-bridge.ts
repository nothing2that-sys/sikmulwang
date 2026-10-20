import { SikmulwangDB, initializeDatabase } from '../../../src/lib/db/database';
import * as backup from '../../../src/lib/backup/repository';
import { readArchive } from '../../../src/lib/backup/archive';
const db=new SikmulwangDB();
const bridge={
  async initialize(){return initializeDatabase(db);},
  async dump(){const result:Record<string,unknown[]>={};for(const table of db.tables){const rows=await table.toArray();result[table.name]=table.name==='mediaBlobs'?await Promise.all(rows.map(async r=>({...r,blob:Array.from(new Uint8Array(await r.blob.arrayBuffer()))}))):rows;}return result;},
  async export(){const meta=await initializeDatabase(db);const result=await backup.exportBackup(db,{epoch:meta.epoch,generation:meta.activeGenerationId});return Array.from(new Uint8Array(await result.blob.arrayBuffer()));},
  async stage(bytes:number[]){const meta=await initializeDatabase(db);return backup.stageBackup(db,{epoch:meta.epoch,generation:meta.activeGenerationId},new Blob([new Uint8Array(bytes)]));},
  async activate(id:string){return backup.activateBackup(db,id);},
  async cancel(id:string){return backup.cancelBackup(db,id);},
  async contents(bytes:number[]){const result=await readArchive(new Blob([new Uint8Array(bytes)]));return {manifest:result.manifest,stores:result.data.stores};},
  async seedAbandonedExport(){const meta=await initializeDatabase(db);const now=new Date().toISOString();await db.transaction('rw',db.meta,async()=>{await db.meta.put({key:'backupJob:abandoned',value:{id:'abandoned',kind:'EXPORT',state:'EXPORTING',source:{epoch:meta.epoch,generation:meta.activeGenerationId},sourceProfileId:meta.activeProfileId,createdAt:now,updatedAt:now,progress:0,contentRevision:0},updatedAt:now});await db.meta.put({key:'backupLock',value:'abandoned',updatedAt:now});await db.meta.put({key:'writeFence',value:true,updatedAt:now});});},
};
declare global {interface Window { p4Test:typeof bridge }}
window.p4Test=bridge;
