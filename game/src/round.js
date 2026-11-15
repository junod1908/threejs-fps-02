// HARBOURFALL — round.js
// The match state machine: freeze (buy) → live → planted → round end,
// sixteen rounds at most, sides swap after the eighth, first to nine.
// This module owns spawning, the buy menu's rules, bot shopping, the
// plant / defuse channels, win checks and every money reward. Bots and
// the human only express intents; everything they cause lands here.

import {
  FREEZE_TIME, ROUND_TIME, BOMB_TIME, PLANT_TIME, DEFUSE_TIME, ROUND_END_TIME,
  ROUNDS_TO_WIN, MAX_ROUNDS, SWAP_ROUND, START_MONEY, MONEY_CAP,
  REWARD_PLANT, REWARD_PLANTER, REWARD_WIN_ELIM, REWARD_WIN_OBJECTIVE,
  REWARD_LOSS_BASE, REWARD_LOSS_STEP, REWARD_LOSS_MAX, WEAPONS, BUY_ITEMS,
} from './config.js';
import { SPAWNS, SITES, siteAt } from './map.js';
import { refillWeapon } from './weapons.js';
import { assignRoles } from './bots.js';
import { attackingCrew, isAttacker, pushEvent } from './state.js';

function giveMoney(actor, amount) {
  actor.money = Math.max(0, Math.min(MONEY_CAP, actor.money + amount));
}

export function buyItem(state, actor, key) {
  if (state.phase !== 'freeze' || !actor.alive) return false;
  const item = BUY_ITEMS.find((b) => b.key === key);
  if (!item || actor.money < item.price) return false;
  if (key === 'armor') {
    if (actor.armor >= 1) return false;
    actor.armor = 1;
  } else if (key === 'armorhelm') {
    if (actor.armor >= 2) return false;
    actor.armor = 2;
  } else if (key === 'flash' || key === 'smoke') {
    if (actor.grenades[key] >= 2) return false;
    actor.grenades[key]++;
  } else {
    const def = WEAPONS[key];
    if (actor[def.slot] && actor[def.slot].key === key) return false;
    actor[def.slot] = { key, mag: 0, reserve: 0 };
    refillWeapon(actor[def.slot]);
    if (def.slot === 'primary') actor.current = 'primary';
  }
  actor.money -= item.price;
  pushEvent(state, 'buy', { by: actor.id });
  return true;
}

// Bots shop with a simple ladder: full buy when rich, a force buy when
// poor, armour before a second grenade, nothing on a true eco.
function buyBotGear(state, actor) {
  const m = () => actor.money;
  const buy = (k) => buyItem(state, actor, k);
  if (!actor.primary) {
    if (m() >= 2700) buy('rifle');
    else if (m() >= 1250 && state.round > 1) buy(Math.random() < 0.6 ? 'smg' : 'scatter');
  }
  if (actor.armor === 0 && m() >= 1000) buy('armorhelm');
  else if (actor.armor === 0 && m() >= 650) buy('armor');
  if (actor.armor === 1 && m() >= 2400) buy('armorhelm');
  if (isAttacker(state, actor) && actor.grenades.smoke === 0 && m() >= 900) buy('smoke');
  if (actor.grenades.flash === 0 && m() >= 700) buy('flash');
}

function resetActorForRound(state, actor, fullReset) {
  const atk = isAttacker(state, actor);
  const cells = atk ? SPAWNS.atk : SPAWNS.def;
  const sameCrew = state.actors.filter((a) => a.crew === actor.crew);
  const idx = sameCrew.indexOf(actor);
  const cell = cells[idx % cells.length];
  actor.pos.x = cell.x + ((idx * 37) % 3 - 1) * 0.9;
  actor.pos.z = cell.z + ((idx * 53) % 3 - 1) * 0.9;
  actor.vel.x = 0; actor.vel.z = 0;
  actor.yaw = Math.atan2(actor.pos.x, actor.pos.z); // face map centre
  actor.pitch = 0;
  actor.alive = true;
  actor.hp = 100;
  actor.channel = null; actor.channelT = 0;
  actor.blindUntil = 0;
  actor.hasBomb = false;
  actor.trigger = false;
  actor.reloadUntil = 0;
  if (fullReset) {
    actor.money = START_MONEY;
    actor.primary = null;
    actor.armor = 0;
    actor.grenades = { flash: 0, smoke: 0 };
    actor.current = 'sidearm';
  } else if (!actor.primary) {
    actor.current = 'sidearm';
  }
  if (actor.primary) refillWeapon(actor.primary);
  refillWeapon(actor.sidearm);
}

export function startMatch(state) {
  state.crews[0].score = 0; state.crews[1].score = 0;
  state.crews[0].lossStreak = 0; state.crews[1].lossStreak = 0;
  for (const a of state.actors) { a.kills = 0; a.deaths = 0; }
  state.round = 0;
  nextRound(state, true);
}

export function nextRound(state, fullReset = false) {
  state.round++;
  const swapReset = state.round === SWAP_ROUND + 1;
  for (const a of state.actors) resetActorForRound(state, a, fullReset || swapReset);
  // the pack goes to the human when they attack, else a random attacker
  const attackers = state.actors.filter((a) => isAttacker(state, a));
  const carrier = attackers.find((a) => a.isHuman) || attackers[Math.floor(Math.random() * attackers.length)];
  carrier.hasBomb = true;
  state.bomb.state = 'carried';
  state.bomb.carrier = carrier;
  state.bomb.site = null;
  state.smokes.length = 0;
  state.grenadesLive.length = 0;
  state.phase = 'freeze';
  state.phaseEndsAt = state.time + FREEZE_TIME;
  state.roundTimer = ROUND_TIME;
  assignRoles(state);
  for (const a of state.actors) if (!a.isHuman) buyBotGear(state, a);
  pushEvent(state, 'roundStart', { round: state.round });
}

function endRound(state, winnerCrew, how) {
  state.phase = 'roundEnd';
  state.phaseEndsAt = state.time + ROUND_END_TIME;
  state.roundResult = { crew: winnerCrew, how };
  state.crews[winnerCrew].score++;
  const loserCrew = 1 - winnerCrew;
  state.crews[winnerCrew].lossStreak = 0;
  state.crews[loserCrew].lossStreak++;
  const winReward = how === 'objective' ? REWARD_WIN_OBJECTIVE : REWARD_WIN_ELIM;
  const lossReward = Math.min(REWARD_LOSS_MAX, REWARD_LOSS_BASE + (state.crews[loserCrew].lossStreak - 1) * REWARD_LOSS_STEP);
  for (const a of state.actors) {
    if (a.crew === winnerCrew) giveMoney(a, winReward);
    else giveMoney(a, lossReward);
    a.channel = null; a.channelT = 0; a.trigger = false;
  }
  state.banner = {
    title: `${winnerCrew === state.human.crew ? 'Round won' : 'Round lost'} — ${how}`,
    sub: `Vipers ${state.crews[0].score} · ${state.crews[1].score} Wardens`,
    until: state.time + ROUND_END_TIME,
  };
  pushEvent(state, 'roundEnd', { crew: winnerCrew, how });
}

function explodeBomb(state) {
  const b = state.bomb;
  b.state = 'exploded';
  pushEvent(state, 'explosion', { x: b.pos.x, z: b.pos.z });
  for (const a of state.actors) {
    if (!a.alive) continue;
    const d = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
    if (d < 10) {
      a.hp -= Math.round(160 * (1 - d / 11));
      if (a.hp <= 0) { a.alive = false; a.deaths++; pushEvent(state, 'kill', { victim: a.id, x: a.pos.x, z: a.pos.z }); }
    }
  }
  endRound(state, attackingCrew(state), 'objective');
}

// Progress a plant or defuse channel for one actor; returns true when the
// actor is genuinely channelling this step (for the HUD progress ring).
function stepChannel(state, actor, dt) {
  const kind = actor.channel;
  if (!kind || !actor.alive) { actor.channelT = 0; return; }
  let ok = false;
  if (kind === 'plant' && state.phase === 'live' && actor.hasBomb && siteAt(actor.pos)) ok = true;
  if (kind === 'defuse' && state.phase === 'planted' && !isAttacker(state, actor)) {
    const d = Math.hypot(state.bomb.pos.x - actor.pos.x, state.bomb.pos.z - actor.pos.z);
    if (d < 2.1) ok = true;
  }
  if (!ok) { actor.channelT = 0; return; }
  actor.channelT += dt;
  actor.trigger = false;
  const need = kind === 'plant' ? PLANT_TIME : DEFUSE_TIME;
  if (actor.channelT < need) return;
  actor.channel = null; actor.channelT = 0;
  if (kind === 'plant') {
    const b = state.bomb;
    b.state = 'planted';
    b.site = siteAt(actor.pos);
    b.pos = { x: actor.pos.x, z: actor.pos.z };
    b.plantedAt = state.time;
    actor.hasBomb = false;
    b.carrier = null;
    state.phase = 'planted';
    state.phaseEndsAt = state.time + BOMB_TIME;
    for (const a of state.actors) if (isAttacker(state, a)) giveMoney(a, REWARD_PLANT);
    giveMoney(actor, REWARD_PLANTER);
    state.banner = { title: `Detpack planted — site ${b.site}`, sub: 'Wardens, move.', until: state.time + 3 };
    pushEvent(state, 'planted', { site: b.site, x: b.pos.x, z: b.pos.z });
  } else {
    state.bomb.state = 'defused';
    pushEvent(state, 'defused', {});
    endRound(state, 1 - attackingCrew(state), 'defuse');
  }
}

export function stepRound(state, dt) {
  const t = state.time;
  for (const a of state.actors) stepChannel(state, a, dt);
  if (state.phase === 'freeze') {
    if (t >= state.phaseEndsAt) {
      state.phase = 'live';
      state.phaseEndsAt = t + ROUND_TIME;
      pushEvent(state, 'live', {});
    }
    return;
  }
  if (state.phase === 'live') {
    state.roundTimer = Math.max(0, state.phaseEndsAt - t);
    // a dropped pack is picked up by the first attacker to reach it
    if (state.bomb.state === 'dropped') {
      for (const a of state.actors) {
        if (!a.alive || !isAttacker(state, a)) continue;
        const d = Math.hypot(state.bomb.pos.x - a.pos.x, state.bomb.pos.z - a.pos.z);
        if (d < 1.3) {
          a.hasBomb = true;
          state.bomb.state = 'carried';
          state.bomb.carrier = a;
          pushEvent(state, 'bombPickup', { by: a.id });
          break;
        }
      }
    }
    const atkAlive = state.actors.some((a) => a.alive && isAttacker(state, a));
    const defAlive = state.actors.some((a) => a.alive && !isAttacker(state, a));
    if (!atkAlive) return endRound(state, 1 - attackingCrew(state), 'elimination');
    if (!defAlive) return endRound(state, attackingCrew(state), 'elimination');
    if (t >= state.phaseEndsAt) return endRound(state, 1 - attackingCrew(state), 'time');
    return;
  }
  if (state.phase === 'planted') {
    state.roundTimer = Math.max(0, state.phaseEndsAt - t);
    // warning beeps: every second, twice a second inside the last ten
    const remain = state.phaseEndsAt - t;
    const interval = remain < 10 ? 0.5 : 1;
    if (Math.floor(remain / interval) !== Math.floor((remain + dt) / interval)) {
      pushEvent(state, 'beep', { final: remain < 5, x: state.bomb.pos.x, z: state.bomb.pos.z });
    }
    if (t >= state.phaseEndsAt) explodeBomb(state);
    return;
  }
  if (state.phase === 'roundEnd') {
    if (t < state.phaseEndsAt) return;
    const [s0, s1] = [state.crews[0].score, state.crews[1].score];
    if ((s0 >= ROUNDS_TO_WIN || s1 >= ROUNDS_TO_WIN || state.round >= MAX_ROUNDS) && s0 !== s1) {
      state.phase = 'matchEnd';
      state.winner = s0 > s1 ? 0 : 1;
      pushEvent(state, 'matchEnd', { winner: state.winner });
      return;
    }
    if (state.round >= MAX_ROUNDS) { // 8–8: honours shared
      state.phase = 'matchEnd';
      state.winner = -1;
      pushEvent(state, 'matchEnd', { winner: -1 });
      return;
    }
    nextRound(state);
  }
}
