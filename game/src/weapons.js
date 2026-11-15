// HARBOURFALL — weapons.js
// Gunplay for every actor, human and bot alike: hitscan fire with a spread
// model that punishes movement, recoil that kicks the aim up and settles,
// head shots that multiply damage, armour that halves what it covers,
// reloads, and thrown flash / smoke grenades. Damage, kills and the bomb
// drop are resolved here; round wins are round.js's business.

import { WEAPONS, WALK_SPEED, REWARD_KILL, MONEY_CAP } from './config.js';
import { eyePos, raycastWorld, raycastActor } from './physics.js';
import { pushEvent } from './state.js';

export function refillWeapon(inst) {
  const def = WEAPONS[inst.key];
  inst.mag = def.mag;
  inst.reserve = def.reserve;
}
export function currentDef(actor) {
  return WEAPONS[actor[actor.current].key];
}
export function lookAngles(from, eyeH, tx, ty, tz) {
  const dx = tx - from.x, dy = ty - eyeH, dz = tz - from.z;
  const flat = Math.hypot(dx, dz);
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, flat) };
}

const _eye = { x: 0, y: 0, z: 0 };
function spreadNow(actor, def) {
  const move = actor.speedNow / WALK_SPEED;
  let s = def.spread * (1 + def.moveSpread * move * 0.55);
  if (actor.crouch) s *= 0.72;
  return s + (actor.bloom || 0);
}

export function damageAt(def, dist) {
  const over = Math.max(0, dist - def.rangeStart) / 10;
  return def.damage * Math.pow(def.falloff, over);
}

function applyHit(state, shooter, victim, def, hit) {
  let dmg = damageAt(def, hit.dist);
  if (hit.head) dmg *= def.headMult;
  // armour halves body damage; the head is covered only with a helmet
  if (victim.armor > 0 && (!hit.head || victim.armor >= 2)) dmg *= 0.5;
  dmg = Math.max(1, Math.round(dmg));
  victim.hp -= dmg;
  state.stats.hits++;
  pushEvent(state, 'hit', { by: shooter.id, victim: victim.id, head: hit.head, dmg, x: victim.pos.x, z: victim.pos.z });
  if (victim.hp <= 0 && victim.alive) killActor(state, shooter, victim, def, hit.head);
}

export function killActor(state, killer, victim, def, head) {
  victim.alive = false;
  victim.hp = 0;
  victim.deaths++;
  victim.channel = null;
  if (killer && killer !== victim) {
    killer.kills++;
    killer.money = Math.min(MONEY_CAP, killer.money + REWARD_KILL);
  }
  state.killfeed.push({
    killer: killer ? killer.name : '—', killerCrew: killer ? killer.crew : -1,
    victim: victim.name, victimCrew: victim.crew,
    weapon: def ? def.name : 'Detpack', head: !!head, at: state.time,
  });
  if (state.killfeed.length > 5) state.killfeed.shift();
  pushEvent(state, 'kill', { victim: victim.id, by: killer ? killer.id : -1, x: victim.pos.x, z: victim.pos.z });
  if (victim.hasBomb) {
    victim.hasBomb = false;
    state.bomb.state = 'dropped';
    state.bomb.carrier = null;
    state.bomb.pos = { x: victim.pos.x, z: victim.pos.z };
    pushEvent(state, 'bombDropped', { x: victim.pos.x, z: victim.pos.z });
  }
}

// Fire one trigger pull (one bullet, or a scattergun's worth of pellets).
function fireOnce(state, actor, def, inst) {
  eyePos(actor, _eye);
  const spread = spreadNow(actor, def);
  const pitch = actor.pitch + (actor.recoilPitch || 0);
  const pellets = def.pellets || 1;
  const mx = _eye.x - Math.sin(actor.yaw) * 0.45;
  const mz = _eye.z - Math.cos(actor.yaw) * 0.45;
  for (let p = 0; p < pellets; p++) {
    const a = (Math.random() * 2 - 1) * spread;
    const b = (Math.random() * 2 - 1) * spread;
    // perturb the look direction by two small angles
    const cy = Math.cos(actor.yaw + a), sy = Math.sin(actor.yaw + a);
    const cp = Math.cos(pitch + b), sp = Math.sin(pitch + b);
    const dx = -sy * cp, dy = sp, dz = -cy * cp;
    const wallDist = raycastWorld(_eye.x, _eye.y, _eye.z, dx, dy, dz, 120);
    let best = null, bestActor = null;
    for (const other of state.actors) {
      if (!other.alive || other === actor || other.crew === actor.crew) continue;
      const hit = raycastActor(_eye.x, _eye.y, _eye.z, dx, dy, dz, other, Math.min(wallDist, 120));
      if (hit && (!best || hit.dist < best.dist)) { best = hit; bestActor = other; }
    }
    const endDist = best ? best.dist : wallDist;
    pushEvent(state, 'tracer', {
      x1: mx, y1: _eye.y - 0.14, z1: mz,
      x2: _eye.x + dx * endDist, y2: _eye.y + dy * endDist, z2: _eye.z + dz * endDist,
      color: def.tracer, wall: !best && wallDist < 120,
    });
    if (best) applyHit(state, actor, bestActor, def, best);
  }
  inst.mag--;
  state.stats.shots++;
  actor.bloom = Math.min(0.02, (actor.bloom || 0) + 0.0035);
  actor.recoilPitch = (actor.recoilPitch || 0) + def.recoil * 0.0105;
  actor.nextShotAt = state.time + 60 / def.rpm;
  state.noises.push({ x: actor.pos.x, z: actor.pos.z, radius: 34, at: state.time, byCrew: actor.crew });
  pushEvent(state, 'shot', { by: actor.id, weapon: def.key, x: actor.pos.x, z: actor.pos.z });
}

// Per-step weapon handling for one actor: reloads, trigger, grenades.
export function stepWeapon(state, actor, dt) {
  actor.bloom = Math.max(0, (actor.bloom || 0) - dt * 0.012);
  actor.recoilPitch = (actor.recoilPitch || 0) * Math.max(0, 1 - dt * 7);
  if (!actor.alive) return;
  const inst = actor[actor.current];
  const def = WEAPONS[inst.key];
  if (actor.wantReload && inst.mag < def.mag && inst.reserve > 0 && actor.reloadUntil <= state.time) {
    actor.reloadUntil = state.time + def.reload;
    pushEvent(state, 'reload', { by: actor.id, x: actor.pos.x, z: actor.pos.z });
  }
  actor.wantReload = false;
  if (actor.reloadUntil > state.time) { actor.trigger = false; return; }
  if (actor.reloadUntil > 0 && actor.reloadUntil <= state.time) {
    const take = Math.min(def.mag - inst.mag, inst.reserve);
    inst.mag += take; inst.reserve -= take;
    actor.reloadUntil = 0;
  }
  if (!actor.trigger) { actor.triggerHeld = false; return; }
  if (state.time < actor.nextShotAt) return;
  if (!def.auto && actor.triggerHeld) return;
  actor.triggerHeld = true;
  if (inst.mag <= 0) {
    actor.nextShotAt = state.time + 0.3;
    actor.wantReload = true;
    pushEvent(state, 'dry', { by: actor.id });
    return;
  }
  fireOnce(state, actor, def, inst);
}

// ------------------------------------------------------------ grenades
// Thrown grenades fly as simple projectiles in state.grenadesLive, bounce
// once on the ground, then go off: a flash blinds whoever is looking at
// it, a smoke drops a vision-blocking cloud for 7.5 seconds.
export function throwGrenade(state, actor, kind) {
  if (actor.grenades[kind] <= 0 || !actor.alive) return;
  actor.grenades[kind]--;
  eyePos(actor, _eye);
  const cp = Math.cos(actor.pitch + 0.25);
  state.grenadesLive.push({
    kind, byCrew: actor.crew,
    x: _eye.x, y: _eye.y, z: _eye.z,
    vx: -Math.sin(actor.yaw) * cp * 13,
    vy: Math.sin(actor.pitch + 0.25) * 13 + 2.5,
    vz: -Math.cos(actor.yaw) * cp * 13,
    at: state.time + 1.4,
  });
  pushEvent(state, 'throw', { by: actor.id, kind });
}

export function stepGrenades(state, dt) {
  const live = state.grenadesLive;
  for (let i = live.length - 1; i >= 0; i--) {
    const g = live[i];
    g.vy -= 18 * dt;
    g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
    if (g.y < 0.12) { g.y = 0.12; g.vy *= -0.35; g.vx *= 0.7; g.vz *= 0.7; }
    if (state.time < g.at) continue;
    live.splice(i, 1);
    if (g.kind === 'smoke') {
      state.smokes.push({ x: g.x, z: g.z, r: 3.4, until: state.time + 7.5 });
      pushEvent(state, 'smoke', { x: g.x, z: g.z });
    } else {
      pushEvent(state, 'flashbang', { x: g.x, y: g.y, z: g.z });
      for (const a of state.actors) {
        if (!a.alive) continue;
        const dx = a.pos.x - g.x, dz = a.pos.z - g.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 26) continue;
        // facing: dot of the actor's look with the direction to the flash
        const fx = g.x - a.pos.x, fz = g.z - a.pos.z;
        const fl = Math.hypot(fx, fz) || 1;
        const dot = (-Math.sin(a.yaw)) * (fx / fl) + (-Math.cos(a.yaw)) * (fz / fl);
        if (dot < 0.15) continue;
        const wall = raycastWorld(a.pos.x, 1.5, a.pos.z, fx / fl, 0, fz / fl, dist);
        if (wall < dist - 0.3) continue;
        const strength = dot * Math.max(0, 1 - dist / 30);
        a.blindUntil = Math.max(a.blindUntil, state.time + 3.2 * strength);
        if (a.isHuman) pushEvent(state, 'blinded', { strength });
      }
    }
  }
  // prune expired smokes
  for (let i = state.smokes.length - 1; i >= 0; i--) {
    if (state.smokes[i].until < state.time) state.smokes.splice(i, 1);
  }
}
