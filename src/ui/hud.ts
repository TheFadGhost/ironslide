// HUD + shared UI stylesheet. All DOM built with createElement, static strings only.
import { CAR_COLORS } from '../config';

export interface HudData {
  phase: 'countdown' | 'racing' | 'finished';
  countdownNumber: number;
  speedKmh: number;
  rpm01: number;
  gear: number;
  lap: number;
  lapsTotal: number;
  position: number;
  totalCars: number;
  curLapMs: number;
  lastLapMs: number | null;
  bestLapMs: number | null;
  wrongWay: boolean;
  damage01: number;
  standingRows: Array<{ id: number; name: string; isPlayer: boolean; gapText: string; lapText: string }>;
}

export const ACCENT = '#c8452c';

export function paintHex(id: number): string {
  const c = CAR_COLORS[((id % CAR_COLORS.length) + CAR_COLORS.length) % CAR_COLORS.length];
  return '#' + c.paint.toString(16).padStart(6, '0');
}

export function fmtMs(ms: number | null): string {
  if (ms === null || !isFinite(ms)) return '--:--.---';
  const t = Math.max(0, Math.floor(ms));
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(t % 1000).padStart(3, '0')}`;
}

let stylesInjected = false;
export function ensureUiStyles(): void {
  if (stylesInjected || document.getElementById('ironslide-ui-styles')) return;
  stylesInjected = true;
  const st = document.createElement('style');
  st.id = 'ironslide-ui-styles';
  st.textContent = `
.is-hud,.is-menu,.is-results-wrap,.is-minimap{position:absolute;font-family:'Segoe UI',system-ui,sans-serif;color:#e8e6e1}
.is-panel{background:rgba(10,12,16,.72);border:1px solid rgba(255,255,255,.09);border-radius:6px}
.is-label{font-size:10px;letter-spacing:.08em;text-transform:uppercase;opacity:.65}
.is-mono{font-family:'Consolas','Courier New',monospace}
.is-hud{inset:0;pointer-events:none;user-select:none}
.is-tower{position:absolute;top:14px;left:14px;padding:7px 6px;min-width:212px}
.is-tower-row{display:flex;align-items:center;gap:8px;padding:3px 8px;border-left:2px solid transparent;border-radius:2px}
.is-tower-row.player{border-left-color:${ACCENT};background:rgba(200,69,44,.12)}
.is-tower-pos{width:16px;text-align:right;opacity:.7;font-size:11px}
.is-tower-chip{width:9px;height:9px;border-radius:2px;flex:none}
.is-tower-name{flex:1;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:104px}
.is-tower-gap{font-size:11px;opacity:.85}
.is-lapbox{position:absolute;top:14px;left:50%;transform:translateX(-50%);text-align:center;padding:7px 20px 9px}
.is-lapbox .is-cur{font-size:26px;line-height:1.15;margin-top:2px}
.is-lapbox .is-sub{font-size:11px;opacity:.85;display:flex;gap:16px;justify-content:center;margin-top:1px}
.is-speedbox{position:absolute;right:14px;bottom:14px;padding:10px 14px;display:flex;align-items:flex-end;gap:14px}
.is-speed-num{font-size:46px;line-height:.92;font-weight:700}
.is-speed-side{display:flex;flex-direction:column;gap:5px;padding-bottom:2px}
.is-gearstrip{display:flex;gap:3px}
.is-gearcell{width:17px;height:17px;line-height:17px;text-align:center;font-size:11px;background:rgba(255,255,255,.06);border-radius:2px;color:#8a8f98}
.is-gearcell.on{background:#e8e6e1;color:#10131a;font-weight:700}
.is-rpmbar{display:flex;gap:2px;width:158px;height:9px}
.is-rpmseg{flex:1;background:rgba(255,255,255,.08);border-radius:1px}
.is-rpmseg.f{background:#e8e6e1}
.is-rpmseg.red.f{background:${ACCENT}}
.is-damage{position:absolute;bottom:18px;left:50%;transform:translateX(-50%);width:230px;text-align:center}
.is-damage-track{height:5px;margin-top:4px;background:rgba(255,255,255,.08);border-radius:3px;overflow:hidden}
.is-damage-fill{height:100%;width:0%;border-radius:3px}
.is-countdown{position:absolute;left:50%;top:40%;transform:translate(-50%,-50%);display:none;font-size:128px;font-weight:800;color:#f2ede4;text-shadow:0 4px 24px rgba(0,0,0,.55)}
.is-countdown.go{color:${ACCENT};font-size:96px}
.is-countdown.pop{animation:is-pop .85s ease-out both}
@keyframes is-pop{0%{transform:translate(-50%,-50%) scale(1.55);opacity:0}18%{opacity:1}100%{transform:translate(-50%,-50%) scale(1);opacity:.95}}
.is-banner{position:absolute;top:19%;left:50%;transform:translateX(-50%);padding:9px 28px;font-size:20px;font-weight:700;letter-spacing:.14em;display:none}
.is-banner.wrongway{color:#ff6a52;animation:is-blink .65s steps(2,start) infinite}
.is-banner.finallap{color:${ACCENT}}
.is-banner.on{display:block}
@keyframes is-blink{0%,100%{opacity:1}50%{opacity:.15}}
.is-minimap{left:14px;bottom:14px;padding:5px;pointer-events:none}
.is-minimap canvas{display:block}
.is-menu{inset:0;pointer-events:auto;display:flex;align-items:center;justify-content:center;overflow:auto;
  background:radial-gradient(1100px 640px at 50% 28%,rgba(32,38,48,.60),rgba(8,10,14,.94)),linear-gradient(180deg,#0d1117,#090b0f);
  transition:opacity .25s ease,visibility .25s ease}
.is-menu.hidden{opacity:0;visibility:hidden;pointer-events:none}
.is-menu-inner{text-align:center;padding:34px 22px;max-width:720px;margin:auto}
.is-title{font-family:'Arial Narrow','Helvetica Neue Condensed',Impact,sans-serif;font-size:clamp(58px,9vw,108px);font-weight:900;letter-spacing:.22em;margin-right:-.22em;color:#f2ede4;line-height:1}
.is-title b{color:${ACCENT};font-weight:900}
.is-subtitle{margin-top:8px;font-size:11px;letter-spacing:.42em;margin-right:-.42em;text-transform:uppercase;opacity:.65}
.is-startbtn{margin-top:30px;padding:14px 52px;background:${ACCENT};color:#f6f2ea;border:none;border-radius:6px;font-size:13px;font-weight:700;letter-spacing:.18em;cursor:pointer;transition:filter .12s ease,transform .12s ease}
.is-startbtn:hover{filter:brightness(1.18)}
.is-startbtn:active{transform:scale(.98)}
.is-cols{display:flex;gap:18px;justify-content:center;margin-top:30px;text-align:left;flex-wrap:wrap}
.is-col{padding:14px 18px;min-width:264px;max-width:320px;flex:1}
.is-keysrow{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:4px 0;font-size:12px}
.is-keysrow .k{white-space:nowrap}
kbd{font-family:'Consolas','Courier New',monospace;font-size:11px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);border-radius:3px;padding:1px 6px;margin-right:2px}
.is-setrow{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:8px 0;font-size:12px}
.is-setrow input[type=range]{width:132px;accent-color:${ACCENT}}
.is-setrow input[type=checkbox]{accent-color:${ACCENT};width:15px;height:15px}
.is-footer{margin-top:26px;font-size:10px;letter-spacing:.14em;opacity:.5}
.is-results-wrap{inset:0;display:flex;align-items:center;justify-content:center;pointer-events:auto;background:rgba(6,8,11,.45);transition:opacity .3s ease,visibility .3s ease}
.is-results-wrap.hidden{opacity:0;visibility:hidden;pointer-events:none}
.is-results-panel{min-width:430px;padding:22px 28px;transform:translateY(26px);transition:transform .35s cubic-bezier(.2,.8,.25,1)}
.is-results-wrap:not(.hidden) .is-results-panel{transform:translateY(0)}
.is-results-headline{font-size:22px;font-weight:800;letter-spacing:.12em;margin-bottom:14px}
.is-results-headline.podium{color:${ACCENT}}
.is-results-table{width:100%;border-collapse:collapse;font-size:12px}
.is-results-table th{text-align:left;padding:5px 10px;border-bottom:1px solid rgba(255,255,255,.09)}
.is-results-table td{padding:6px 10px;border-bottom:1px solid rgba(255,255,255,.04)}
.is-results-table th:nth-child(n+3),.is-results-table td:nth-child(n+3){text-align:right}
.is-results-table tr.player td{background:rgba(200,69,44,.12)}
.is-results-table tr.player td:first-child{border-left:2px solid ${ACCENT}}
.is-results-table tr.dnf td{opacity:.42}
.is-chipdot{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:7px;vertical-align:baseline}
.is-actions{display:flex;gap:10px;justify-content:center;margin-top:18px}
.is-btn{padding:11px 30px;border-radius:6px;font-size:12px;font-weight:700;letter-spacing:.16em;cursor:pointer;transition:filter .12s ease,background .12s ease}
.is-btn-accent{background:${ACCENT};color:#f6f2ea;border:none}
.is-btn-accent:hover{filter:brightness(1.18)}
.is-btn-ghost{background:transparent;color:#cfd2d6;border:1px solid rgba(255,255,255,.18)}
.is-btn-ghost:hover{background:rgba(255,255,255,.08)}
`;
  document.head.appendChild(st);
}

interface RowRefs {
  el: HTMLDivElement;
  pos: HTMLSpanElement;
  name: HTMLSpanElement;
  gap: HTMLSpanElement;
}

const RPM_SEGS = 24;

export function createHud(root: HTMLElement): { update(d: HudData): void; setVisible(v: boolean): void } {
  ensureUiStyles();
  const hud = document.createElement('div');
  hud.className = 'is-hud';

  // position tower (top-left)
  const tower = document.createElement('div');
  tower.className = 'is-panel is-tower';
  const towerBody = document.createElement('div');
  tower.appendChild(towerBody);

  // lap box (top-center)
  const lapbox = document.createElement('div');
  lapbox.className = 'is-panel is-lapbox';
  const lapLine = document.createElement('div');
  lapLine.className = 'is-label';
  const lapA = span('', 'is-mono'), lapB = span('', 'is-mono');
  lapLine.append(text('LAP '), lapA, text(' / '), lapB);
  const curTime = span('--:--.---', 'is-mono is-cur');
  const sub = document.createElement('div');
  sub.className = 'is-sub is-mono';
  const lastT = span('LAST --:--.---'), bestT = span('BEST --:--.---');
  lastT.className = ''; bestT.className = '';
  sub.append(lastT, bestT);
  lapbox.append(lapLine, curTime, sub);

  // speed cluster (bottom-right)
  const speedbox = document.createElement('div');
  speedbox.className = 'is-panel is-speedbox';
  const speedNum = span('0', 'is-mono is-speed-num');
  const side = document.createElement('div');
  side.className = 'is-speed-side';
  const kmh = span('km/h', 'is-label');
  const gearStrip = document.createElement('div');
  gearStrip.className = 'is-gearstrip is-mono';
  const gearCells: HTMLSpanElement[] = [];
  for (const g of ['R', 'N', '1', '2', '3', '4', '5', '6']) {
    const c = document.createElement('span');
    c.className = 'is-gearcell';
    c.textContent = g;
    gearStrip.appendChild(c);
    gearCells.push(c);
  }
  const rpmBar = document.createElement('div');
  rpmBar.className = 'is-rpmbar';
  const rpmSegs: HTMLSpanElement[] = [];
  const redFrom = Math.floor(RPM_SEGS * 0.85);
  for (let i = 0; i < RPM_SEGS; i++) {
    const sgm = document.createElement('span');
    sgm.className = 'is-rpmseg' + (i >= redFrom ? ' red' : '');
    rpmBar.appendChild(sgm);
    rpmSegs.push(sgm);
  }
  side.append(kmh, gearStrip, rpmBar);
  speedbox.append(speedNum, side);

  // damage (bottom-center)
  const dmg = document.createElement('div');
  dmg.className = 'is-damage';
  const dmgLabel = span('DAMAGE', 'is-label');
  const track = document.createElement('div');
  track.className = 'is-damage-track';
  const dmgFill = document.createElement('div');
  dmgFill.className = 'is-damage-fill';
  track.appendChild(dmgFill);
  dmg.append(dmgLabel, track);

  // countdown + banners
  const cd = document.createElement('div');
  cd.className = 'is-countdown is-mono';
  const wrongWay = document.createElement('div');
  wrongWay.className = 'is-panel is-banner wrongway';
  wrongWay.textContent = 'WRONG WAY';
  const finalLap = document.createElement('div');
  finalLap.className = 'is-panel is-banner finallap';
  finalLap.textContent = 'FINAL LAP';

  hud.append(tower, lapbox, speedbox, dmg, cd, wrongWay, finalLap);
  root.appendChild(hud);

  // cached state — only touch DOM when values change
  let towerSig = '';
  let rowRefs = new Map<number, RowRefs>();
  let lastSpeed = '', lastGearIdx = -1, lastRpmFill = -1, lastLap = -1, lastLapsTotal = -1;
  let lastCur = '', lastLast = '', lastBest = '';
  let lastDmgW = '', lastDmgHue = -1;
  let cdShown = '', lastPhase = '';
  let prevLapForFinal = 0;
  let goTimer = 0, flTimer = 0;

  function span(txt: string, cls?: string): HTMLSpanElement {
    const s = document.createElement('span');
    if (cls) s.className = cls;
    s.textContent = txt;
    return s;
  }
  function text(t: string): Text { return document.createTextNode(t); }

  function showCountdown(txt: string, go: boolean): void {
    cd.textContent = txt;
    cd.classList.toggle('go', go);
    cd.style.display = 'block';
    cd.classList.remove('pop');
    void cd.offsetWidth; // restart animation
    cd.classList.add('pop');
  }
  function hideCountdown(): void {
    cd.style.display = 'none';
    cdShown = '';
  }

  function rebuildTower(rows: HudData['standingRows']): void {
    towerBody.textContent = '';
    rowRefs.clear();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const el = document.createElement('div');
      el.className = 'is-tower-row' + (r.isPlayer ? ' player' : '');
      const chip = document.createElement('span');
      chip.className = 'is-tower-chip';
      chip.style.background = paintHex(r.id);
      const pos = span(String(i + 1), 'is-mono is-tower-pos'); // position = row order
      const name = span(r.name, 'is-tower-name');
      const gap = span(r.gapText, 'is-mono is-tower-gap');
      el.append(pos, chip, name, gap);
      towerBody.appendChild(el);
      rowRefs.set(r.id, { el, pos, name, gap });
    }
    towerSig = rows.map((r) => r.id).join('|');
  }

  function update(d: HudData): void {
    // standings
    const sig = d.standingRows.map((r) => r.id).join('|');
    if (sig !== towerSig) rebuildTower(d.standingRows);
    for (let i = 0; i < d.standingRows.length; i++) {
      const r = d.standingRows[i];
      const ref = rowRefs.get(r.id);
      if (!ref) continue;
      if (ref.gap.textContent !== r.gapText) ref.gap.textContent = r.gapText;
      ref.el.classList.toggle('player', r.isPlayer);
    }

    // lap box
    if (d.lap !== lastLap) { lapA.textContent = String(Math.max(d.lap, 1)); lastLap = d.lap; }
    if (d.lapsTotal !== lastLapsTotal) { lapB.textContent = String(d.lapsTotal); lastLapsTotal = d.lapsTotal; }
    const curS = fmtMs(d.curLapMs);
    if (curS !== lastCur) { curTime.textContent = curS; lastCur = curS; }
    const lastS = 'LAST ' + fmtMs(d.lastLapMs);
    if (lastS !== lastLast) { lastT.textContent = lastS; lastLast = lastS; }
    const bestS = 'BEST ' + fmtMs(d.bestLapMs);
    if (bestS !== lastBest) { bestT.textContent = bestS; lastBest = bestS; }

    // speed + gear + rpm
    const spd = String(Math.round(d.speedKmh));
    if (spd !== lastSpeed) { speedNum.textContent = spd; lastSpeed = spd; }
    const gi = d.gear < 0 ? 0 : d.gear === 0 ? 1 : Math.min(7, d.gear + 1);
    if (gi !== lastGearIdx) {
      for (let i = 0; i < gearCells.length; i++) gearCells[i].classList.toggle('on', i === gi);
      lastGearIdx = gi;
    }
    const fill = Math.round(Math.min(1, Math.max(0, d.rpm01)) * RPM_SEGS);
    if (fill !== lastRpmFill) {
      for (let i = 0; i < RPM_SEGS; i++) rpmSegs[i].classList.toggle('f', i < fill);
      lastRpmFill = fill;
    }

    // damage
    const dw = (Math.min(1, Math.max(0, d.damage01)) * 100).toFixed(1) + '%';
    if (dw !== lastDmgW) { dmgFill.style.width = dw; lastDmgW = dw; }
    const hue = Math.round((1 - Math.min(1, Math.max(0, d.damage01))) * 120);
    if (hue !== lastDmgHue) { dmgFill.style.background = `hsl(${hue},70%,45%)`; lastDmgHue = hue; }

    // countdown / GO
    if (d.phase === 'countdown') {
      const n = String(Math.max(1, Math.min(99, Math.ceil(d.countdownNumber))));
      if (n !== cdShown) { cdShown = n; showCountdown(n, false); }
    } else if (lastPhase === 'countdown') {
      cdShown = 'GO';
      showCountdown('GO', true);
      window.clearTimeout(goTimer);
      goTimer = window.setTimeout(hideCountdown, 900);
    } else if (cdShown && cdShown !== 'GO') {
      hideCountdown();
    }
    lastPhase = d.phase;

    // banners
    wrongWay.classList.toggle('on', d.wrongWay && d.phase === 'racing');
    if (d.phase === 'countdown') prevLapForFinal = 0;
    const hitFinal = d.phase === 'racing' && d.lapsTotal > 0 && d.lap >= d.lapsTotal && prevLapForFinal < d.lapsTotal;
    prevLapForFinal = d.lap;
    if (hitFinal) {
      finalLap.classList.add('on');
      window.clearTimeout(flTimer);
      flTimer = window.setTimeout(() => finalLap.classList.remove('on'), 3000);
    }
  }

  function setVisible(v: boolean): void {
    hud.style.display = v ? '' : 'none';
  }

  return { update, setVisible };
}
