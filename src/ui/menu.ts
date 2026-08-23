// Main menu overlay. Mutates the passed settings object live; main reads the same object.
import { ensureUiStyles } from './hud';

export interface MenuSettings {
  masterVolume: number;
  postFx: boolean;
  shadows: boolean;
}

export function createMenu(
  root: HTMLElement,
  cb: { onStart: () => void },
  settings: MenuSettings,
): { show(): void; hide(): void; isVisible(): boolean } {
  ensureUiStyles();
  const menu = document.createElement('div');
  menu.className = 'is-menu';

  const inner = document.createElement('div');
  inner.className = 'is-menu-inner';

  const title = document.createElement('div');
  title.className = 'is-title';
  title.textContent = 'IRON';
  const titleAccent = document.createElement('b');
  titleAccent.textContent = 'SLIDE';
  title.appendChild(titleAccent);

  const subtitle = document.createElement('div');
  subtitle.className = 'is-subtitle';
  subtitle.textContent = 'weight-transfer racing';

  const startBtn = document.createElement('button');
  startBtn.className = 'is-startbtn';
  startBtn.type = 'button';
  startBtn.textContent = 'START RACE';
  startBtn.addEventListener('click', cb.onStart);

  const cols = document.createElement('div');
  cols.className = 'is-cols';

  // left column — controls
  const keysCol = document.createElement('div');
  keysCol.className = 'is-panel is-col';
  const keysHead = document.createElement('div');
  keysHead.className = 'is-label';
  keysHead.textContent = 'CONTROLS';
  keysCol.appendChild(keysHead);
  const keys: Array<[string, string]> = [
    ['W/S or ↑/↓', 'throttle / brake'],
    ['A/D or ←/→', 'steer'],
    ['SPACE', 'handbrake'],
    ['C', 'camera'],
    ['R', 'reset to track'],
    ['ESC', 'pause'],
  ];
  for (const [k, d] of keys) {
    const row = document.createElement('div');
    row.className = 'is-keysrow';
    const kd = document.createElement('span');
    kd.className = 'k';
    const kb = document.createElement('kbd');
    kb.textContent = k;
    kd.appendChild(kb);
    const dd = document.createElement('span');
    dd.style.opacity = '0.8';
    dd.textContent = d;
    row.append(kd, dd);
    keysCol.appendChild(row);
  }
  const gpRow = document.createElement('div');
  gpRow.className = 'is-keysrow';
  const gpK = document.createElement('span');
  gpK.className = 'k';
  gpK.style.fontSize = '10px';
  gpK.style.opacity = '0.65';
  gpK.textContent = 'GAMEPAD';
  const gpD = document.createElement('span');
  gpD.style.cssText = 'opacity:.8;text-align:right;font-size:11px';
  gpD.textContent = 'RT/LT triggers · stick steer · A handbrake · Y camera · MENU pause';
  gpRow.append(gpK, gpD);
  keysCol.appendChild(gpRow);

  // right column — settings (mutate the shared object live)
  const setCol = document.createElement('div');
  setCol.className = 'is-panel is-col';
  const setHead = document.createElement('div');
  setHead.className = 'is-label';
  setHead.textContent = 'SETTINGS';
  setCol.appendChild(setHead);

  const volLabel = document.createElement('span');
  volLabel.textContent = 'MASTER VOLUME';
  const volInput = document.createElement('input');
  volInput.type = 'range';
  volInput.min = '0';
  volInput.max = '1';
  volInput.step = '0.01';
  volInput.value = String(settings.masterVolume);
  volInput.addEventListener('input', () => {
    settings.masterVolume = parseFloat(volInput.value);
  });
  addSettingRow(setCol, volLabel, volInput);

  const fxLabel = document.createElement('span');
  fxLabel.textContent = 'POST FX';
  const fxInput = document.createElement('input');
  fxInput.type = 'checkbox';
  fxInput.checked = settings.postFx;
  fxInput.addEventListener('change', () => {
    settings.postFx = fxInput.checked;
  });
  addSettingRow(setCol, fxLabel, fxInput);

  const shLabel = document.createElement('span');
  shLabel.textContent = 'SHADOWS';
  const shInput = document.createElement('input');
  shInput.type = 'checkbox';
  shInput.checked = settings.shadows;
  shInput.addEventListener('change', () => {
    settings.shadows = shInput.checked;
  });
  addSettingRow(setCol, shLabel, shInput);

  cols.append(keysCol, setCol);

  const footer = document.createElement('div');
  footer.className = 'is-footer';
  footer.textContent = 'all assets procedural · original designs';

  inner.append(title, subtitle, startBtn, cols, footer);
  menu.appendChild(inner);
  root.appendChild(menu);

  let visible = true;

  function addSettingRow(parent: HTMLElement, label: HTMLSpanElement, input: HTMLInputElement): void {
    const row = document.createElement('div');
    row.className = 'is-setrow';
    row.append(label, input);
    parent.appendChild(row);
  }

  return {
    show(): void {
      visible = true;
      menu.classList.remove('hidden');
      startBtn.focus();
    },
    hide(): void {
      visible = false;
      menu.classList.add('hidden');
    },
    isVisible(): boolean {
      return visible;
    },
  };
}
