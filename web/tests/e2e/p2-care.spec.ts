import { test, expect, type Page } from '@playwright/test';

async function setup(page: Page, withRule = true) {
  await page.goto('/plants');
  await page.getByRole('button',{name:'새 식물 심기',exact:true}).click();
  await page.getByLabel('식물 이름 (애칭 또는 품종) *').fill('P2 브라우저 식물');
  await page.getByLabel('시즌 시작일 (선택)').fill('2026-01-01');
  await page.getByRole('button',{name:'식물 등록 완료'}).click();
  await expect(page.getByRole('heading',{name:'P2 브라우저 식물',exact:true})).toBeVisible();
  await page.goto('/');
  if (!withRule) return;
  await page.getByRole('button',{name:'사용자 확인 간격 설정'}).click();
  await page.getByLabel('토양 확인 간격 (일, 1~30)').fill('5');
  await page.getByRole('button',{name:'확인하고 저장'}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function record(page: Page,name: string) {
  await page.getByRole('button',{name,exact:true}).click();
  await page.getByRole('button',{name:'확인하고 저장'}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
test('P2 registration → explicit rule → WATERED → offline reload → undo → MOIST → snooze',async ({page,context}) => {
  await setup(page);
  await record(page,'물 줬어요');
  await page.getByText('실제 관리 기록 이력',{exact:true}).click();
  await expect(page.getByText(/물주기 · .* · 유효/)).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await context.setOffline(true); await page.reload();
  await page.getByText('실제 관리 기록 이력',{exact:true}).click();
  await record(page,'되돌리기');
  await record(page,'아직 촉촉해요');
  await expect(page.getByText(/촉촉함 관찰 · .* · 유효/)).toBeVisible();
  await record(page,'되돌리기');
  await record(page,'나중에');
  await page.goto('/week');
  await expect(page.getByText(/연기됨/)).toBeVisible();
  await context.setOffline(false);
});

for (const width of [320,360,390,768,1280]) test(`P2 care dialog keyboard/reflow at ${width}`,async ({page}) => {
  await page.setViewportSize({width,height:640}); await setup(page);
  const trigger = page.getByRole('button',{name:'물 줬어요',exact:true});
  await trigger.click(); const dialog = page.getByRole('dialog',{name:'관리 기록 확인'});
  expect(await dialog.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
  if (width === 390 || width === 1280) await page.screenshot({path:`test-results/p2-care-${width}.png`,fullPage:true});
  expect((await dialog.boundingBox())!.height).toBeLessThanOrEqual(640);
  for (let i=0;i<8;i++) { await page.keyboard.press('Tab'); expect(await dialog.evaluate(e => e.contains(document.activeElement))).toBe(true); }
  await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('P2 missing rule allows direct factual records and undo without an automatic task',async ({page}) => {
  await setup(page,false);
  await expect(page.getByRole('button',{name:'물 줬어요',exact:true})).toHaveCount(0);
  await record(page,'실제 물주기 직접 기록');
  await page.reload(); await page.getByText('실제 관리 기록 이력',{exact:true}).click();
  await expect(page.getByText(/물주기 · .* · 유효/)).toBeVisible();
  await record(page,'되돌리기');
  await expect(page.getByRole('button',{name:'물 줬어요',exact:true})).toHaveCount(0);
  await record(page,'촉촉함 직접 관찰 기록');
  await expect(page.getByText(/촉촉함 관찰 · .* · 유효/)).toBeVisible();
});

test('P2 two tabs concurrent completion produces one event',async ({page,context}) => {
  await setup(page); const other = await context.newPage(); await other.goto('/');
  await page.getByRole('button',{name:'물 줬어요',exact:true}).click();
  await other.getByRole('button',{name:'물 줬어요',exact:true}).click();
  await Promise.all([page.getByRole('button',{name:'확인하고 저장'}).click(),other.getByRole('button',{name:'확인하고 저장'}).click()]);
  await expect(page.getByRole('dialog')).toHaveCount(0); await expect(other.getByRole('dialog')).toHaveCount(0);
  const count = await page.evaluate(() => new Promise<number>((resolve,reject) => {
    const request = indexedDB.open('sikmulwang-db');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {const db = request.result; const q = db.transaction('careEvents').objectStore('careEvents').count();q.onsuccess=() => {resolve(q.result);db.close();};};
  }));
  expect(count).toBe(1);
});

test('P2 conflicting snooze keeps draft and retry key after latest state refresh',async ({page,context}) => {
  await setup(page); const other = await context.newPage(); await other.goto('/');
  await other.getByRole('button',{name:'나중에',exact:true}).click();
  const date = new Date(); date.setDate(date.getDate()+3);
  const due = date.toISOString().slice(0,10);
  await other.getByLabel('다시 확인할 날짜').fill(due);
  await record(page,'나중에');
  await other.getByRole('button',{name:'확인하고 저장'}).click();
  await expect(other.getByRole('dialog')).toBeVisible();
  await expect(other.getByRole('dialog').getByRole('alert')).toBeVisible();
  await expect(other.getByLabel('다시 확인할 날짜')).toHaveValue(due);
  await other.getByRole('button',{name:'최신 상태 반영'}).click();
  await other.getByRole('button',{name:'다시 시도',exact:true}).click();
  await expect(other.getByRole('dialog')).toHaveCount(0);
  await other.goto('/week'); await expect(other.getByText(new RegExp(due+' · 연기됨'))).toBeVisible();
});

test('P2 nested care Escape retains P1 edit draft and future tasks remain available',async ({page}) => {
  await setup(page); await page.goto('/plants');
  await page.getByRole('button',{name:'관리하기',exact:true}).click();
  const parent = page.getByRole('dialog',{name:'P2 브라우저 식물 관리'});
  const name = parent.getByLabel('식물 이름');
  await name.fill('미저장 이름 초안');
  await parent.getByRole('button',{name:'사용자 확인 간격 설정'}).click();
  const child = page.getByRole('dialog',{name:'사용자 확인 간격 설정'});
  await child.getByLabel('토양 확인 간격 (일, 1~30)').fill('30');
  await page.keyboard.press('Escape');
  await expect(parent).toBeVisible(); await expect(name).toHaveValue('미저장 이름 초안');
  await parent.getByRole('button',{name:'사용자 확인 간격 설정'}).click();
  await page.getByRole('dialog',{name:'사용자 확인 간격 설정'}).getByLabel('토양 확인 간격 (일, 1~30)').fill('30');
  await page.getByRole('dialog',{name:'사용자 확인 간격 설정'}).getByRole('button',{name:'확인하고 저장'}).click();
  await parent.getByRole('button',{name:'물 줬어요',exact:true}).click();
  await page.getByRole('dialog',{name:'관리 기록 확인'}).getByRole('button',{name:'확인하고 저장'}).click();
  await expect(parent.getByRole('button',{name:'물 줬어요',exact:true})).toBeVisible();
  await expect(name).toHaveValue('미저장 이름 초안');
});
