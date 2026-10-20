import { test,expect,type Page } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
let bundle: string;
test.beforeAll(async()=> {
  const built=await build({ configFile:false,logLevel:'silent',build:{ write:false,minify:false,target:'es2022',lib:{ entry:resolve('tests/e2e/fixtures/legacy-p2.ts'),name:'LegacyP2',formats:['iife'] } } });
  const output=Array.isArray(built)?built[0]:built; if(!('output' in output)) throw new Error('no bundle'); bundle=output.output.filter(c=>c.type==='chunk').map(c=>c.code).join('\n');
});
async function openOld(page:Page) {
  await page.route('**/__p2_test/index.html',r=>r.fulfill({ contentType:'text/html',body:'<!doctype html><meta charset=utf-8><title>Isolated P2</title>' }));
  await page.route('**/__p2_test/legacy.js',r=>r.fulfill({ contentType:'text/javascript',body:bundle }));
  await page.goto('/__p2_test/index.html'); await page.addScriptTag({ url:'/__p2_test/legacy.js' });
}
async function error(action:()=>Promise<unknown>) { try { await action(); return 'UNEXPECTED_SUCCESS'; } catch(e) { return String(e); } }
async function seedUI(page:Page) {
  await page.goto('/plants'); await page.getByRole('button',{ name:'새 식물 심기',exact:true }).click();
  await page.getByLabel('식물 이름 (애칭 또는 품종) *').fill('P3 합성 식물');
  await page.getByRole('button',{ name:'식물 등록 완료' }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  // Registration creates an active season by default.
  await page.goto('/journal/new'); await page.getByLabel('식물 및 재배 시즌').selectOption({ index:1 });
  await page.getByLabel('일기 날짜').fill('2026-10-20');
  await page.getByLabel('제목 (선택)').fill('합성 새잎 일기'); await page.getByLabel('일기 내용').fill('어제 관찰한 새잎');
  await page.getByLabel('성장',{ exact:true }).check();
  await expect(page.getByRole('status').filter({ hasText:'초안이 이 기기에 저장됐어요.' })).toBeVisible();
}
async function syntheticPng(page:Page) {
  return page.evaluate(()=> { const c=document.createElement('canvas'); c.width=64;c.height=32;const ctx=c.getContext('2d')!; ctx.fillStyle='green';ctx.fillRect(0,0,64,32);return c.toDataURL('image/png').split(',')[1]; });
}
test('native Chromium actual P2 kept tab/reopened app refuse journal-only purge',async({ page:old,context })=> {
  await openOld(old); await old.evaluate(()=>window.legacyP2.initialize()); const seeded=await old.evaluate(()=>window.legacyP2.seed());
  const app=await context.newPage(); await app.goto('/journal/new'); await app.getByLabel('식물 및 재배 시즌').selectOption({ index:1 });
  await app.getByLabel('일기 내용').fill('P3 only history'); await expect(app.getByText('초안이 이 기기에 저장됐어요.',{ exact:true })).toBeVisible();
  const before=await old.evaluate(()=>window.legacyP2.dump()); expect(before.careEvents).toHaveLength(0); expect(before.diaries).toHaveLength(1); expect(await old.evaluate(()=>window.legacyP2.isOpen())).toBe(true);
  expect(await error(()=>old.evaluate(p=>window.legacyP2.purge(p.id,p.revision),seeded.planting))).toContain('지원하지 않는 스키마');
  expect(await error(()=>old.evaluate(p=>window.legacyP2.edit(p.id,p.revision),seeded.planting))).toContain('지원하지 않는 스키마');
  expect(await error(()=>old.evaluate(()=>window.legacyP2.reopen()))).toContain('지원하지 않는 스키마');
  const reopened=await context.newPage(); await openOld(reopened); expect(await error(()=>reopened.evaluate(()=>window.legacyP2.initialize()))).toContain('지원하지 않는 스키마');
  expect(await error(()=>reopened.evaluate(p=>window.legacyP2.purge(p.id,p.revision),seeded.planting))).toContain('지원하지 않는 스키마');
  expect(await old.evaluate(()=>window.legacyP2.dump())).toEqual(before);
});
test('native P2 lock first survives transition and P3 lock first rejects queued old writer',async({ page:old,context })=> {
  await openOld(old); await old.evaluate(()=>window.legacyP2.initialize()); const { planting }=await old.evaluate(()=>window.legacyP2.seed());
  await old.evaluate(id=>window.legacyP2.holdOld(id),planting.id);
  const app=await context.newPage(); const navigation=app.goto('/plants'); await old.evaluate(()=>window.legacyP2.release()); await navigation;
  await expect(app.getByRole('heading',{ name:'P2 lock first',exact:true })).toBeVisible();
  expect(await error(()=>old.evaluate(p=>window.legacyP2.purge(p.id,2),planting))).toContain('지원하지 않는 스키마');
});
test('native P3 lock first blocks queued P2 purge with full state preservation',async({ page:old,context })=> {
  await openOld(old); await old.evaluate(()=>window.legacyP2.initialize()); const { planting }=await old.evaluate(()=>window.legacyP2.seed());
  await old.evaluate(()=>window.legacyP2.holdNew());
  const queued=await context.newPage(); await openOld(queued);
  const result=error(()=>queued.evaluate(p=>window.legacyP2.purge(p.id,1),planting));
  await old.evaluate(()=>window.legacyP2.release()); expect(await result).toContain('지원하지 않는 스키마');
  const after=await old.evaluate(()=>window.legacyP2.dump()); expect(after.plantings).toHaveLength(1);
});
test('native transition quota rollback preserves P2, retry transitions once',async({ page:old,context })=> {
  await openOld(old); await old.evaluate(()=>window.legacyP2.seedFrozen()); const before=await old.evaluate(()=>window.legacyP2.dump());
  const app=await context.newPage(); await app.addInitScript(()=> {
    const original=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(value,...keys) { if(this.name==='meta' && value.key==='schemaVersion' && value.value===3 && !sessionStorage.getItem('p3-fault')) { sessionStorage.setItem('p3-fault','1'); throw new DOMException('injected quota','QuotaExceededError'); } return Reflect.apply(original,this,[value,...keys]); };
  });
  await app.goto('/plants'); await expect(app.getByRole('heading',{ name:'데이터베이스 접근 오류' })).toBeVisible();
  expect(await old.evaluate(()=>window.legacyP2.dump())).toEqual(before); expect(await old.evaluate(()=>window.legacyP2.initialize())).toMatchObject({ schemaVersion:2,epoch:2 });
  await app.reload(); await expect(app.getByRole('heading',{ name:'보존 대상 P2 식물',exact:true })).toBeVisible();
  const after=await old.evaluate(()=>window.legacyP2.dump()); for(const name of Object.keys(before)) if(name!=='meta') expect(after[name]).toEqual(before[name]);
  expect(after.meta).toContainEqual(expect.objectContaining({ key:'epoch',value:3 }));
});
test('journal date/draft/photo persist offline, edit and trash/restore without network personal payload',async({ page,context })=> {
  const requests: string[]=[]; page.on('request',r=> { if(!['GET','HEAD'].includes(r.method())) requests.push(r.method()+' '+r.url()); });
  await seedUI(page); const url=page.url(); const png=await syntheticPng(page);
  await page.getByLabel('사진 첨부',{ exact:true }).setInputFiles({ name:'plant.png',mimeType:'image/png',buffer:Buffer.from(png,'base64') });
  await expect(page.getByAltText('첨부 전 사진 미리보기')).toBeVisible(); await page.getByRole('button',{ name:'사진 첨부 저장' }).click();
  await expect(page.getByAltText('일기 첨부 사진')).toBeVisible(); await page.getByRole('button',{ name:'일기 저장',exact:true }).click();
  await expect(page.getByText('일기가 이 기기에 저장됐어요.',{ exact:true })).toBeVisible();
  await page.evaluate(async()=> { await navigator.serviceWorker.ready; }); await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true); await page.reload(); await expect(page.getByLabel('일기 내용')).toHaveValue('어제 관찰한 새잎'); await expect(page.getByLabel('일기 날짜')).toHaveValue('2026-10-20'); await expect(page.getByLabel('성장',{ exact:true })).toBeChecked(); await expect(page.getByAltText('일기 첨부 사진')).toBeVisible();
  await page.getByLabel('일기 내용').fill('오프라인 편집'); await expect(page.getByText('일기가 이 기기에 저장됐어요.',{ exact:true })).toBeVisible();
  await page.getByRole('button',{ name:'첨부 제거',exact:true }).click(); await expect(page.getByRole('button',{ name:'첨부 복원',exact:true })).toBeVisible();
  await page.getByRole('button',{ name:'첨부 복원',exact:true }).click(); await expect(page.getByAltText('일기 첨부 사진')).toBeVisible();
  await page.getByRole('link',{ name:'일기장으로',exact:true }).click(); await expect(page.getByText('오프라인 편집',{ exact:true })).toBeVisible();
  await page.getByRole('button',{ name:'달력',exact:true }).click(); await page.getByRole('button',{ name:'2026-10-20 기록 1개',exact:true }).click(); await expect(page.getByRole('heading',{ name:'합성 새잎 일기',exact:true })).toBeVisible();
  await page.getByRole('button',{ name:'일기 휴지통으로' }).click(); await expect(page.getByRole('heading',{ name:'합성 새잎 일기',exact:true })).toHaveCount(0);
  await page.getByLabel('일기 휴지통 보기').check(); await page.getByRole('button',{ name:'일기 복원',exact:true }).click(); await page.getByLabel('일기 휴지통 보기').uncheck(); await expect(page.getByAltText('일기 첨부 사진')).toBeVisible();
  await page.goto(url); await expect(page.getByLabel('일기 내용')).toHaveValue('오프라인 편집'); expect(requests).toEqual([]);
});
test('photo failure/cancel keeps persistent text draft, two tabs conflict and preserve fork',async({ page,context })=> {
  await seedUI(page); const url=page.url();
  await page.getByLabel('사진 첨부',{ exact:true }).setInputFiles({ name:'bad.heic',mimeType:'image/heic',buffer:Buffer.from('synthetic bad image') }); await expect(page.getByRole('alert')).toContainText('텍스트 초안은 유지');
  await page.reload(); await expect(page.getByLabel('일기 내용')).toHaveValue('어제 관찰한 새잎');
  await expect(page.getByRole('alert')).toContainText('이전 사진 작업이 완료되지');
  const other=await context.newPage(); await other.goto(url); await expect(other.getByLabel('일기 내용')).toHaveValue('어제 관찰한 새잎');
  await page.getByLabel('일기 내용').fill('첫 탭 커밋'); await expect(page.getByText('초안이 이 기기에 저장됐어요.',{ exact:true })).toBeVisible();
  await other.getByLabel('일기 내용').fill('두 번째 탭 보존'); await expect(other.getByRole('alert').filter({ hasText:'다른 탭' })).toBeVisible(); await expect(other.getByLabel('일기 내용')).toHaveValue('두 번째 탭 보존');
  await other.getByRole('button',{ name:'현재 입력을 별도 초안으로 보존' }).click(); await expect(other).not.toHaveURL(url); await expect(other.getByLabel('일기 내용')).toHaveValue('두 번째 탭 보존');
  await page.reload(); await expect(page.getByLabel('일기 내용')).toHaveValue('첫 탭 커밋');
});
for(const width of [320,360,390,768,1280]) test(`P3 populated editor/calendar keyboard and 200% reflow at ${width}`,async({ page })=> {
  await page.setViewportSize({ width,height:900 }); await seedUI(page);
  await page.getByRole('button',{ name:'일기 저장',exact:true }).focus(); await page.keyboard.press('Enter'); await expect(page.getByText('일기가 이 기기에 저장됐어요.',{ exact:true })).toBeVisible();
  await page.evaluate(()=> { document.documentElement.style.fontSize='200%'; });
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('link',{ name:'일기장으로',exact:true }).click(); await page.getByRole('button',{ name:'달력',exact:true }).click(); expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const buttons=page.locator('.calendar-day'); for(const b of await buttons.all()) { const box=await b.boundingBox();expect(box!.height).toBeGreaterThanOrEqual(44); }
});

test('EXIF GPS is absent from processed bytes and orientation is applied; MIME, damage and large dimensions fail closed',async({ page })=> {
  await openOld(page);
  const jpeg=await page.evaluate(()=> { const canvas=document.createElement('canvas');canvas.width=64;canvas.height=32;const ctx=canvas.getContext('2d')!;ctx.fillStyle='green';ctx.fillRect(0,0,64,32);return Array.from(Uint8Array.from(atob(canvas.toDataURL('image/jpeg').split(',')[1]),c=>c.charCodeAt(0))); });
  const tiff=Buffer.alloc(128); tiff.write('II',0);tiff.writeUInt16LE(42,2);tiff.writeUInt32LE(8,4);tiff.writeUInt16LE(2,8);
  tiff.writeUInt16LE(0x112,10);tiff.writeUInt16LE(3,12);tiff.writeUInt32LE(1,14);tiff.writeUInt16LE(6,18);
  tiff.writeUInt16LE(0x8825,22);tiff.writeUInt16LE(4,24);tiff.writeUInt32LE(1,26);tiff.writeUInt32LE(38,30);
  tiff.writeUInt16LE(2,38); tiff.writeUInt16LE(1,40);tiff.writeUInt16LE(2,42);tiff.writeUInt32LE(2,44);tiff.write('N\0',48);
  tiff.writeUInt16LE(2,52);tiff.writeUInt16LE(5,54);tiff.writeUInt32LE(3,56);tiff.writeUInt32LE(68,60);
  tiff.writeUInt32LE(37,68);tiff.writeUInt32LE(1,72);tiff.writeUInt32LE(30,76);tiff.writeUInt32LE(1,80);tiff.writeUInt32LE(0,84);tiff.writeUInt32LE(1,88);
  tiff.write('SYNTHETIC_GPS_ONLY',96);
  const exif=Buffer.concat([Buffer.from('Exif\0\0'),tiff]);const marker=Buffer.alloc(4);marker[0]=255;marker[1]=225;marker.writeUInt16BE(exif.length+2,2);
  const input=Buffer.concat([Buffer.from(jpeg.slice(0,2)),marker,exif,Buffer.from(jpeg.slice(2))]);
  const output=await page.evaluate(bytes=>window.legacyP2.process(bytes,'image/jpeg','synthetic.jpg'),Array.from(input));
  expect(output).toMatchObject({ width:32,height:64 });
  for(const bytes of [output.display,output.thumbnail]) {
    const b=Buffer.from(bytes);expect(b.includes(Buffer.from('Exif'))).toBe(false);expect(b.includes(Buffer.from('SYNTHETIC_GPS_ONLY'))).toBe(false);
    let offset=8;const kinds=[];while(offset<b.length){const size=b.readUInt32BE(offset);kinds.push(b.toString('ascii',offset+4,offset+8));offset+=size+12;}expect(kinds.every(k=>['IHDR','IDAT','IEND','PLTE'].includes(k))).toBe(true);
  }
  expect(await error(()=>page.evaluate(bytes=>window.legacyP2.process(bytes,'image/png','wrong.png'),Array.from(input)))).toContain('사진을 처리하지 못했어요');
  expect(await error(()=>page.evaluate(()=>window.legacyP2.process([255,216,...Array(20).fill(0)],'image/jpeg','broken.jpg')))).toContain('사진을 처리하지 못했어요');
  const png=Buffer.from(await syntheticPng(page),'base64');png.writeUInt32BE(9000,16);
  expect(await error(()=>page.evaluate(bytes=>window.legacyP2.process(bytes,'image/png','huge.png'),Array.from(png)))).toContain('사진을 처리하지 못했어요');
});
test('delayed autosave then publish then edit never downgrades published state',async({ page })=> {
  await seedUI(page);
  await page.evaluate(()=> {
    const flags=window as unknown as { holdNext:boolean;held:boolean;releaseWrite:boolean };flags.holdNext=true;flags.held=false;flags.releaseWrite=false;
    const put=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(value,...keys) {
      const result=Reflect.apply(put,this,[value,...keys]);
      if(this.name==='diaries' && flags.holdNext) { flags.holdNext=false;flags.held=true; const keep=()=> { if(!flags.releaseWrite) this.count().onsuccess=keep; };keep(); }
      return result;
    };
  });
  await page.getByLabel('일기 내용').fill('느린 초안 A');
  await expect.poll(()=>page.evaluate(()=>(window as unknown as { held:boolean }).held)).toBe(true);
  await page.getByRole('button',{ name:'일기 저장',exact:true }).click();
  await page.getByLabel('일기 내용').fill('발행 전 최신 B');
  // Let the 500ms debounce queue behind the blocked save and publish.
  await page.waitForTimeout(650);
  await page.evaluate(()=> { (window as unknown as { releaseWrite:boolean }).releaseWrite=true; });
  await expect(page.getByText('일기가 이 기기에 저장됐어요.',{ exact:true })).toBeVisible();
  await page.reload(); await expect(page.getByLabel('일기 내용')).toHaveValue('발행 전 최신 B');
  await page.getByRole('link',{ name:'일기장으로',exact:true }).click(); await expect(page.getByText('저장된 일기 · 성장',{ exact:true })).toBeVisible();
});
test('native photo quota and crypto failures preserve every store and Blob byte; retry succeeds',async({ page,context })=> {
  await seedUI(page);const png=await syntheticPng(page);
  await page.getByLabel('사진 첨부',{ exact:true }).setInputFiles({ name:'plant.png',mimeType:'image/png',buffer:Buffer.from(png,'base64') });await expect(page.getByAltText('첨부 전 사진 미리보기')).toBeVisible();
  const inspect=await context.newPage();await openOld(inspect);const before=await inspect.evaluate(()=>window.legacyP2.dump());
  await page.evaluate(()=> {
    const add=IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add=function(value,...keys) { if(this.name==='mediaLinks' && !sessionStorage.getItem('link-fault')) { sessionStorage.setItem('link-fault','1');throw new DOMException('injected photo quota','QuotaExceededError'); }return Reflect.apply(add,this,[value,...keys]); };
    const put=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(value,...keys) { if(this.name==='mediaLinks' && !sessionStorage.getItem('link-fault')) { sessionStorage.setItem('link-fault','1');throw new DOMException('injected photo quota','QuotaExceededError'); }return Reflect.apply(put,this,[value,...keys]); };
  });
  await page.getByRole('button',{ name:'사진 첨부 저장' }).click();await expect(page.getByRole('alert')).toContainText('quota');expect(await inspect.evaluate(()=>window.legacyP2.dump())).toEqual(before);
  await page.getByRole('button',{ name:'사진 첨부 저장' }).click();await expect(page.getByAltText('일기 첨부 사진')).toBeVisible();
  const withPhoto=await inspect.evaluate(()=>window.legacyP2.dump());expect(withPhoto.mediaBlobs).toHaveLength(2);
  await page.getByLabel('사진 첨부',{ exact:true }).setInputFiles({ name:'plant.png',mimeType:'image/png',buffer:Buffer.from(png,'base64') });await expect(page.getByAltText('첨부 전 사진 미리보기')).toBeVisible();
  const beforeCrypto=await inspect.evaluate(()=>window.legacyP2.dump());
  await page.evaluate(()=> { crypto.subtle.digest=async()=> { throw new Error('injected crypto failure'); }; });
  await page.getByRole('button',{ name:'사진 첨부 저장' }).click();await expect(page.getByRole('alert')).toContainText('crypto');expect(await inspect.evaluate(()=>window.legacyP2.dump())).toEqual(beforeCrypto);
});
test('new selection/cancel/navigation invalidate delayed image work and retain text draft',async({ page })=> {
  await seedUI(page);const png=await syntheticPng(page);
  await page.evaluate(()=> {
    const original=createImageBitmap; const flags=window as unknown as { releaseDecode:()=>void };
    const gate=new Promise<void>(r=>flags.releaseDecode=r);
    window.createImageBitmap=(async(...args: Parameters<typeof createImageBitmap>)=> { await gate;return Reflect.apply(original,window,args); }) as typeof createImageBitmap;
  });
  await page.getByLabel('사진 첨부',{ exact:true }).setInputFiles({ name:'a.png',mimeType:'image/png',buffer:Buffer.from(png,'base64') });
  await expect(page.getByText(/사진 상태: PROCESSING/)).toBeVisible();
  await page.getByLabel('사진 첨부',{ exact:true }).setInputFiles({ name:'b.png',mimeType:'image/png',buffer:Buffer.from(png,'base64') });
  await expect(page.getByText(/사진 상태: PROCESSING/)).toBeVisible();
  await page.getByRole('button',{ name:'사진 선택 취소' }).click(); await page.evaluate(()=> { (window as unknown as { releaseDecode:()=>void }).releaseDecode(); });
  await expect(page.getByAltText('첨부 전 사진 미리보기')).toHaveCount(0);await expect(page.getByRole('button',{ name:'사진 첨부 저장' })).toHaveCount(0);
  await page.getByRole('link',{ name:'일기장으로',exact:true }).click();await page.getByRole('link',{ name:'일기 편집' }).click();await expect(page.getByLabel('일기 내용')).toHaveValue('어제 관찰한 새잎');
});
test('timeline/calendar use effective P2 facts after undo and preserve journal separately',async({ page })=> {
  await seedUI(page);await page.goto('/');
  await page.getByRole('button',{ name:'실제 물주기 직접 기록',exact:true }).click();await page.getByRole('button',{ name:'확인하고 저장' }).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/journal');await expect(page.getByRole('heading',{ name:'관리 기록 · WATERED',exact:true })).toHaveCount(1);
  await page.goto('/');await page.getByText('실제 관리 기록 이력',{ exact:true }).click();await page.getByRole('button',{ name:'되돌리기',exact:true }).click();await page.getByRole('button',{ name:'확인하고 저장' }).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/journal');await expect(page.getByRole('heading',{ name:'관리 기록 · WATERED',exact:true })).toHaveCount(0);await expect(page.getByRole('heading',{ name:'합성 새잎 일기',exact:true })).toBeVisible();
});

test('leaving editor during delayed decode prevents old work from linking into reopened draft',async({ page })=> {
  await seedUI(page);const png=await syntheticPng(page);
  await page.evaluate(()=> {
    const original=createImageBitmap;const flags=window as unknown as { releaseDecode:()=>void;decoded:boolean };flags.decoded=false;
    const gate=new Promise<void>(r=>flags.releaseDecode=r);
    window.createImageBitmap=(async(...args: Parameters<typeof createImageBitmap>)=> { await gate;const result=await Reflect.apply(original,window,args);flags.decoded=true;return result; }) as typeof createImageBitmap;
  });
  await page.getByLabel('사진 첨부',{ exact:true }).setInputFiles({ name:'leaving.png',mimeType:'image/png',buffer:Buffer.from(png,'base64') });
  await expect(page.getByText(/사진 상태: PROCESSING/)).toBeVisible();
  await page.getByRole('link',{ name:'일기장으로',exact:true }).click();await page.evaluate(()=> { (window as unknown as { releaseDecode:()=>void }).releaseDecode(); });
  await expect.poll(()=>page.evaluate(()=>(window as unknown as { decoded:boolean }).decoded)).toBe(true);
  await page.getByRole('link',{ name:'일기 편집' }).click();await expect(page.getByLabel('일기 내용')).toHaveValue('어제 관찰한 새잎');await expect(page.getByAltText('일기 첨부 사진')).toHaveCount(0);await expect(page.getByAltText('첨부 전 사진 미리보기')).toHaveCount(0);
});
