import { chromium } from 'playwright';
import { preview } from 'vite';
import { mkdirSync } from 'fs';

mkdirSync('capture-frames', { recursive: true });
const server = await preview({ preview: { port: 4173 } });
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[ERR]', String(e).slice(0, 200)));
await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await page.screenshot({ path: 'capture-frames/00-menu.png' });

await page.getByRole('button', { name: 'START RACE', exact: true }).click();
await page.waitForTimeout(1000);
await page.keyboard.down('w');

let lastSig = '';
for (let k = 0; k < 30; k++) {
  await page.waitForTimeout(1000);
  const steer = Math.sin(k / 5) * 0.5;
  if (steer > 0.2) {
    await page.keyboard.down('d');
    await page.waitForTimeout(300);
    await page.keyboard.up('d');
  } else if (steer < -0.35) {
    await page.keyboard.down('a');
    await page.waitForTimeout(300);
    await page.keyboard.up('a');
  }
  const buf = await page.screenshot();
  // perceptual signature: mean brightness of a downsampled grid
  const sig = await page.evaluate(() => {
    const c = document.querySelector('#app');
    const t = document.createElement('canvas');
    t.width = 32; t.height = 18;
    const g = t.getContext('2d');
    g.drawImage(c, 0, 0, 32, 18);
    const data = g.getImageData(0, 0, 32, 18).data;
    let sum = 0, sumSq = 0;
    const n = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      const v = (data[i] + data[i + 1] + data[i + 2]) / 3;
      sum += v;
      sumSq += v * v;
    }
    return JSON.stringify([Math.round(sum / n), Math.round(Math.sqrt(sumSq / n - (sum / n) ** 2))]);
  });
  if (sig !== lastSig || k % 4 === 0) {
    const idx = String(2 + k).padStart(2, '0');
    await page.screenshot({ path: `capture-frames/${idx}-race.png` });
    console.log(idx, 'sig', sig);
  }
  lastSig = sig;
}
await page.keyboard.up('w');
console.log('done');
await browser.close();
await new Promise((r) => server.httpServer.close(r));
process.exit(0);
