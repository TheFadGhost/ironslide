import { chromium } from 'playwright';
import { preview } from 'vite';

const server = await preview({ preview: { port: 4174 } });
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
page.on('console', (m) => console.log('[console]', m.type(), m.text().slice(0, 200)));
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const probe1 = await page.evaluate(() => {
  const c = document.querySelector('#app');
  return {
    visibility: document.visibilityState,
    hasCanvas: !!c,
    canvasSize: c ? [c.width, c.height] : null,
    raf: typeof requestAnimationFrame,
    webgl: (() => {
      try {
        const g = c.getContext('webgl2') || c.getContext('webgl');
        return g ? 'yes' : 'no';
      } catch {
        return 'err';
      }
    })(),
  };
});
console.log('probe:', JSON.stringify(probe1));

await page.getByRole('button', { name: 'START RACE', exact: true }).click();
await page.waitForTimeout(500);
const s1 = await page.screenshot();
await page.waitForTimeout(2500);
const hudText = await page.evaluate(() => document.body.innerText.slice(0, 300));
const s2 = await page.screenshot();
console.log('screens differ:', !s1.equals(s2));
console.log('body text:', JSON.stringify(hudText));

// count rAF ticks over 1s
const ticks = await page.evaluate(
  () =>
    new Promise((res) => {
      let n = 0;
      const t0 = performance.now();
      function f() {
        n++;
        if (performance.now() - t0 < 1000) requestAnimationFrame(f);
        else res(n);
      }
      requestAnimationFrame(f);
    })
);
console.log('rAF ticks/sec:', ticks);

await browser.close();
await new Promise((r) => server.httpServer.close(r));
process.exit(0);
