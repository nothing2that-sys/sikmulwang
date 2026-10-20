import {SikmulwangDB} from '../../../src/lib/db/database';
const db=new SikmulwangDB();
async function dump(){
  const snapshot=await db.transaction('r',db.tables,async()=>{
    const result:Record<string,unknown[]>={};
    for(const table of db.tables)result[table.name]=await table.toArray();
    return result;
  });
  const media=snapshot.mediaBlobs as {blob:Blob}[];
  snapshot.mediaBlobs=await Promise.all(media.map(async row=>({...row,blob:Array.from(new Uint8Array(await row.blob.arrayBuffer()))})));
  return snapshot;
}
declare global {interface Window {p5Observer:{dump:typeof dump}}}
window.p5Observer={dump};
