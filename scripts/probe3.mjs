import { chromium } from 'playwright';
import { preview } from 'vite';

const server = await preview({ preview: { port: 4176 } });
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
page.on('pageerror', (e) => console.log('[ERR]', String(e).slice(0, 300)));
await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'START RACE');
  btn?.click();
});
for (let t = 2; t <= 14; t += 3) {
  await page.waitForTimeout(3000);
  const dbg = await page.evaluate(() => window.__iron ? window.__iron() : 'no hook');
  console.log(`t=${t}s\n` + dbg);
}
await browser.close();
await new Promise((r) => server.httpServer.close(r));
process.exit(0);
