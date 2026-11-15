// HARBOURFALL — hud.js
// Every piece of DOM the player reads: health and armour, ammunition and
// money, the round clock and score, a top-down minimap, the killfeed, the
// buy menu, the scoreboard and the centre banners. This module owns the
// DOM; the simulation only writes state, and main.js forwards the events
// that should flash a hitmarker, redden the screen edge or white it out.

import { BUY_ITEMS, WEAPONS, PLANT_TIME, DEFUSE_TIME, TEAM_NAMES, FREEZE_TIME } from './config.js';
import { COLS, ROWS, isSolidCell, SITES } from './map.js';
import { isAttacker, attackingCrew } from './state.js';
import { input, keyPressed } from './input.js';

const $ = (id) => document.getElementById(id);
const els = {};
let buyCallback = null;
let mapCanvas = null;      // prerendered walls for the minimap
let lastFeedStamp = '';

export function initHud(onBuy) {
  buyCallback = onBuy;
  for (const id of ['crosshair', 'hitmarker', 'timer', 'phaseLabel', 'roundLabel', 'scoreL', 'scoreR',
    'healthFill', 'healthNum', 'armorFill', 'armorWrap', 'weaponName', 'ammoMag', 'ammoReserve',
    'money', 'nadeLine', 'killfeed', 'minimap', 'banner', 'bannerTitle', 'bannerSub',
    'channel', 'channelLabel', 'channelFill', 'vignette', 'dmgdir', 'flashfx',
    'buymenu', 'buyGrid', 'buyMoney', 'scoreboard', 'sbBody', 'hint',
    'overlay', 'ovTitle', 'ovCopy', 'ovButton']) els[id] = $(id);
  // prerender the minimap's walls once
  mapCanvas = document.createElement('canvas');
  mapCanvas.width = COLS * 4; mapCanvas.height = ROWS * 4;
  const g = mapCanvas.getContext('2d');
  g.fillStyle = '#12161d'; g.fillRect(0, 0, mapCanvas.width, mapCanvas.height);
  g.fillStyle = '#3c4654';
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (isSolidCell(c, r)) g.fillRect(c * 4, r * 4, 4, 4);
  }
  // buy menu rows, built once; prices and owned state refresh per frame
  BUY_ITEMS.forEach((item, i) => {
    const row = document.createElement('button');
    row.className = 'buy-row';
    row.innerHTML = `<span class="buy-key">${i + 1}</span><span class="buy-name">${item.label}</span>` +
      `<span class="buy-hint">${item.hint}</span><span class="buy-price">$${item.price}</span>`;
    row.addEventListener('click', () => { if (buyCallback) buyCallback(item.key); });
    els.buyGrid.appendChild(row);
  });
}

export function showHitmarker(head) {
  els.hitmarker.classList.toggle('head', !!head);
  els.hitmarker.classList.add('on');
  clearTimeout(showHitmarker._t);
  showHitmarker._t = setTimeout(() => els.hitmarker.classList.remove('on'), 110);
}
export function showDamageFrom(angle) {
  els.dmgdir.style.transform = `translate(-50%, -50%) rotate(${angle}rad)`;
  els.dmgdir.style.opacity = '1';
  clearTimeout(showDamageFrom._t);
  showDamageFrom._t = setTimeout(() => { els.dmgdir.style.opacity = '0'; }, 650);
  els.vignette.style.opacity = '0.85';
  clearTimeout(showDamageFrom._v);
  showDamageFrom._v = setTimeout(() => { els.vignette.style.opacity = '0'; }, 420);
}
export function flashScreen(strength) {
  els.flashfx.style.transition = 'none';
  els.flashfx.style.opacity = String(Math.min(1, 0.35 + strength));
  requestAnimationFrame(() => {
    els.flashfx.style.transition = 'opacity 2.6s linear';
    els.flashfx.style.opacity = '0';
  });
}

function fmtTime(s) {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function updateHud(state) {
  const h = state.human;
  const t = state.time;
  // ---- top bar: clock, score, phase
  let clock = '';
  if (state.phase === 'freeze') clock = fmtTime(Math.min(state.phaseEndsAt - t, FREEZE_TIME));
  else if (state.phase === 'live' || state.phase === 'planted') clock = fmtTime(state.roundTimer);
  els.timer.textContent = clock;
  els.timer.classList.toggle('danger', state.phase === 'planted' || (state.phase === 'live' && state.roundTimer < 11));
  els.phaseLabel.textContent =
    state.phase === 'freeze' ? `BUY — ${isAttacker(state, h) ? 'attack' : 'defend'} as ${TEAM_NAMES[h.crew]}` :
    state.phase === 'planted' ? `DETPACK DOWN — SITE ${state.bomb.site}` :
    state.phase === 'live' ? (isAttacker(state, h) ? 'PLANT THE DETPACK' : 'HOLD THE YARD') :
    state.phase === 'roundEnd' ? 'ROUND OVER' : state.phase === 'matchEnd' ? 'MATCH OVER' : '';
  els.roundLabel.textContent = state.round > 0 ? `ROUND ${state.round} / 16` : '';
  els.scoreL.textContent = String(state.crews[0].score);
  els.scoreR.textContent = String(state.crews[1].score);
  // ---- bottom-left: health and armour
  els.healthFill.style.width = `${Math.max(0, h.hp)}%`;
  els.healthFill.classList.toggle('low', h.hp <= 30);
  els.healthNum.textContent = String(Math.max(0, Math.ceil(h.hp)));
  els.armorWrap.style.opacity = h.armor > 0 ? '1' : '0.25';
  els.armorFill.style.width = h.armor > 0 ? '100%' : '0%';
  // ---- bottom-right: weapon, ammo, money, grenades
  const inst = h[h.current];
  const def = WEAPONS[inst.key];
  els.weaponName.textContent = def.name.toUpperCase();
  els.ammoMag.textContent = String(inst.mag);
  els.ammoMag.classList.toggle('empty', inst.mag === 0);
  els.ammoReserve.textContent = `/ ${inst.reserve}`;
  els.money.textContent = `$${h.money}`;
  els.nadeLine.textContent = `FLASH ×${h.grenades.flash} · SMOKE ×${h.grenades.smoke}${h.hasBomb ? ' · DETPACK' : ''}`;
  els.crosshair.style.setProperty('--gap', `${5 + (h.bloom || 0) * 900 + h.speedNow * 1.6}px`);
  // ---- banner
  if (state.banner && t < state.banner.until) {
    els.banner.hidden = false;
    els.bannerTitle.textContent = state.banner.title;
    els.bannerSub.textContent = state.banner.sub || '';
  } else els.banner.hidden = true;
  // ---- channel progress (planting / defusing)
  if (h.channel && h.channelT > 0) {
    els.channel.hidden = false;
    const need = h.channel === 'plant' ? PLANT_TIME : DEFUSE_TIME;
    els.channelLabel.textContent = h.channel === 'plant' ? 'PLANTING DETPACK' : 'DEFUSING';
    els.channelFill.style.width = `${Math.min(100, (h.channelT / need) * 100)}%`;
  } else els.channel.hidden = true;
  // ---- context hint
  els.hint.textContent = hintFor(state, h);
  // ---- killfeed
  const stamp = state.killfeed.map((f) => `${f.killer}${f.victim}${f.at}`).join('|');
  if (stamp !== lastFeedStamp) {
    lastFeedStamp = stamp;
    els.killfeed.innerHTML = state.killfeed.slice(-4).map((f) =>
      `<div class="feed-row"><b class="crew${f.killerCrew}">${f.killer}</b> [${f.weapon}${f.head ? ' · head' : ''}] <b class="crew${f.victimCrew}">${f.victim}</b></div>`).join('');
  }
  drawMinimap(state);
  updateBuyMenu(state);
  updateScoreboard(state);
}

function hintFor(state, h) {
  if (!h.alive) return 'You are down — watching the round out.';
  if (state.phase === 'freeze') return 'B — buy menu · the round starts when the clock runs out';
  if (h.channel) return '';
  if (isAttacker(state, h) && h.hasBomb) return 'Carry the detpack to site A or B — hold E to plant';
  if (!isAttacker(state, h) && state.bomb.state === 'planted') return 'Get to the detpack — hold E to defuse';
  if (state.bomb.state === 'dropped' && isAttacker(state, h)) return 'The detpack is down — recover it';
  return '';
}

function drawMinimap(state) {
  const cv = els.minimap;
  const g = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  g.clearRect(0, 0, W, H);
  g.drawImage(mapCanvas, 0, 0, W, H);
  const px = (x) => ((x + 46) / 92) * W;
  const pz = (z) => ((z + 32) / 64) * H;
  for (const key of ['A', 'B']) {
    g.strokeStyle = key === 'A' ? '#e08a2e' : '#2ea8e0';
    g.lineWidth = 1.5;
    g.beginPath(); g.arc(px(SITES[key].x), pz(SITES[key].z), 9, 0, Math.PI * 2); g.stroke();
  }
  const h = state.human;
  for (const a of state.actors) {
    if (!a.alive) continue;
    if (a === h) continue;
    if (a.crew !== h.crew) {
      // enemies appear only while their gunfire is fresh
      if (state.time - (a.lastShotAt || -99) > 3) continue;
      g.fillStyle = '#ff5347';
    } else g.fillStyle = a.crew === 0 ? '#e08a2e' : '#3fa7d6';
    g.beginPath(); g.arc(px(a.pos.x), pz(a.pos.z), 2.6, 0, Math.PI * 2); g.fill();
  }
  if (state.bomb.state === 'dropped' || state.bomb.state === 'planted') {
    g.fillStyle = '#ff2a1a';
    g.fillRect(px(state.bomb.pos.x) - 3, pz(state.bomb.pos.z) - 3, 6, 6);
  }
  // the human: white dot with a facing tick
  g.fillStyle = '#fff';
  g.beginPath(); g.arc(px(h.pos.x), pz(h.pos.z), 3.2, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#fff'; g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(px(h.pos.x), pz(h.pos.z));
  g.lineTo(px(h.pos.x) - Math.sin(h.yaw) * 8, pz(h.pos.z) - Math.cos(h.yaw) * 8);
  g.stroke();
}

function updateBuyMenu(state) {
  const h = state.human;
  const open = state.phase === 'freeze' && h.alive && state.round > 0;
  els.buymenu.hidden = !open;
  if (!open) return;
  els.buyMoney.textContent = `$${h.money} — ${TEAM_NAMES[h.crew]} ${isAttacker(state, h) ? 'attack' : 'defend'}`;
  const rows = els.buyGrid.children;
  BUY_ITEMS.forEach((item, i) => {
    const owned =
      (item.key === 'armor' && h.armor >= 1) || (item.key === 'armorhelm' && h.armor >= 2) ||
      ((item.key === 'flash' || item.key === 'smoke') && h.grenades[item.key] >= 2) ||
      (WEAPONS[item.key] && h[WEAPONS[item.key].slot] && h[WEAPONS[item.key].slot].key === item.key);
    rows[i].classList.toggle('cant', h.money < item.price || owned);
    rows[i].querySelector('.buy-price').textContent = owned ? 'OWNED' : `$${item.price}`;
  });
  for (let i = 0; i < BUY_ITEMS.length; i++) {
    if (keyPressed(`Digit${i + 1}`) && buyCallback) buyCallback(BUY_ITEMS[i].key);
  }
}

function updateScoreboard(state) {
  const show = input.keys.has('Tab') || state.phase === 'matchEnd';
  els.scoreboard.hidden = !show;
  if (!show) return;
  const atk = attackingCrew(state);
  const rows = [...state.actors]
    .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
    .map((a) => `<tr class="${a.alive ? '' : 'dead'}"><td>${a.name}${a.isHuman ? ' (you)' : ''}</td>` +
      `<td>${TEAM_NAMES[a.crew]}${a.crew === atk ? ' · ATK' : ' · DEF'}</td>` +
      `<td>${a.kills}</td><td>${a.deaths}</td><td>$${a.money}</td></tr>`).join('');
  els.sbBody.innerHTML = rows;
}

export function showOverlay(title, copy, button) {
  els.overlay.hidden = false;
  els.ovTitle.textContent = title;
  els.ovCopy.textContent = copy;
  els.ovButton.textContent = button;
}
export function hideOverlay() { els.overlay.hidden = true; }
