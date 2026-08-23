import { chromium } from 'playwright';
import { preview } from 'vite';

const server = await preview({ preview: { port: 4175 } });
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
page.on('console', (m) => console.log('[c]', m.type(), m.text().slice(0, 300)));
page.on('pageerror', (e) => console.log('[ERR]', String(e).slice(0, 500)));
await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

const btnInfo = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')];
  return btns.map((b) => ({ text: b.textContent?.trim(), pe: getComputedStyle(b).pointerEvents }));
});
console.log('buttons:', JSON.stringify(btnInfo));

await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'START RACE');
  btn?.click();
});
await page.waitForTimeout(800);
const state1 = await page.evaluate(() => ({
  menuDisplay: document.querySelector('#ui-root')?.children.length,
  bodySnippet: document.body.innerText.slice(0, 80).replace(/\n/g, '|'),
}));
console.log('after js click:', JSON.stringify(state1));
await page.waitForTimeout(2500);
const state2 = await page.evaluate(() => ({
  snippet: document.body.innerText.slice(0, 120).replace(/\n/g, '|'),
}));
console.log('+2.5s:', JSON.stringify(state2));
await browser.close();
await new Promise((r) => server.httpServer.close(r));
process.exit(0);
