// Race results overlay with slide-in panel.
import { ensureUiStyles, fmtMs, paintHex } from './hud';

export interface ResultsRow {
  pos: number;
  name: string;
  isPlayer: boolean;
  bestLapMs: number | null;
  totalTimeMs: number | null;
  status: 'finished' | 'dnf' | 'racing';
}

export function createResults(
  root: HTMLElement,
  cb: { onRematch: () => void; onMenu: () => void },
): { show(rows: ResultsRow[], headline: string): void; hide(): void } {
  ensureUiStyles();
  const wrap = document.createElement('div');
  wrap.className = 'is-results-wrap hidden';

  const panel = document.createElement('div');
  panel.className = 'is-panel is-results-panel';

  const headline = document.createElement('div');
  headline.className = 'is-results-headline';

  const table = document.createElement('table');
  table.className = 'is-results-table';
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const h of ['POS', 'DRIVER', 'BEST LAP', 'TOTAL', 'STATUS']) {
    const th = document.createElement('th');
    th.textContent = h;
    th.className = 'is-label';
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  const tbody = document.createElement('tbody');
  table.append(thead, tbody);

  const actions = document.createElement('div');
  actions.className = 'is-actions';
  const rematchBtn = document.createElement('button');
  rematchBtn.type = 'button';
  rematchBtn.className = 'is-btn is-btn-accent';
  rematchBtn.textContent = 'REMATCH';
  rematchBtn.addEventListener('click', cb.onRematch);
  const menuBtn = document.createElement('button');
  menuBtn.type = 'button';
  menuBtn.className = 'is-btn is-btn-ghost';
  menuBtn.textContent = 'MENU';
  menuBtn.addEventListener('click', cb.onMenu);
  actions.append(rematchBtn, menuBtn);

  panel.append(headline, table, actions);
  wrap.appendChild(panel);
  root.appendChild(wrap);

  function show(rows: ResultsRow[], headlineText: string): void {
    headline.textContent = headlineText;
    // podium headlines (P1/P2/P3) get the accent color
    headline.classList.toggle('podium', /^P[1-3]\b/.test(headlineText));

    tbody.textContent = '';
    for (const r of rows) {
      const trEl = document.createElement('tr');
      trEl.className =
        (r.isPlayer ? 'player ' : '') + (r.status === 'dnf' ? 'dnf' : '');

      const tdPos = document.createElement('td');
      tdPos.className = 'is-mono';
      tdPos.textContent = String(r.pos);

      const tdName = document.createElement('td');
      if (r.isPlayer) {
        const chip = document.createElement('span');
        chip.className = 'is-chipdot';
        chip.style.background = paintHex(0);
        tdName.appendChild(chip);
      }
      tdName.appendChild(document.createTextNode(r.name));
      if (r.isPlayer) tdName.style.fontWeight = '700';

      const tdBest = document.createElement('td');
      tdBest.className = 'is-mono';
      tdBest.textContent = fmtMs(r.bestLapMs);

      const tdTotal = document.createElement('td');
      tdTotal.className = 'is-mono';
      tdTotal.textContent = r.totalTimeMs === null ? '--:--.---' : fmtMs(r.totalTimeMs);

      const tdStatus = document.createElement('td');
      tdStatus.className = 'is-label';
      tdStatus.textContent =
        r.status === 'dnf' ? 'DNF' : r.status === 'racing' ? 'RACING' : 'FIN';

      trEl.append(tdPos, tdName, tdBest, tdTotal, tdStatus);
      tbody.appendChild(trEl);
    }

    wrap.classList.remove('hidden');
    rematchBtn.focus();
  }

  function hide(): void {
    wrap.classList.add('hidden');
  }

  return { show, hide };
}
