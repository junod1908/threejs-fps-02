// HARBOURFALL — bots.js
// The bot brain. Every bot perceives through the same physics the player
// uses (line of sight with smoke, a peripheral-vision cone, hearing from
// the noise list gunfire makes), decides on a slow think tick, and acts
// through the same intents the human sets: a wish direction, a look
// direction and a trigger. Roles are dealt each round by assignRoles:
// attackers split across the two sites with the pack carrier, defenders
// hold points near cover, and everyone rotates on information — a seen
// bomb, a heard shot, a plant.

import { BOT, WALK_SPEED, SNEAK_SPEED, EYE_STAND } from './config.js';
import { findPath, SITES, holdPoints, siteAt } from './map.js';
import { eyePos, lineOfSight } from './physics.js';
import { lookAngles, throwGrenade } from './weapons.js';
import { isAttacker } from './state.js';

export function makeBrain() {
  return {
    role: 'hold',              // atkSite|atkPush|hold|mid|carrier
    site: 'A',
    path: [], pathIdx: 0, pathGoal: null,
    nextThink: Math.random() * 0.2,
    seen: null, seenAt: -99, aimSince: 0,
    lastKnown: null,           // {x, z, at}
    burstUntil: 0, nextBurstAt: 0,
    strafeDir: 1, strafeFlipAt: 0,
    holdPoint: null, holdCrouch: false,
    repathAt: 0, stuckAt: 0,
    threwUtility: false,
    reaction: BOT.reaction[0] + Math.random() * (BOT.reaction[1] - BOT.reaction[0]),
  };
}

export function assignRoles(state) {
  const atk = state.actors.filter((a) => isAttacker(state, a));
  const def = state.actors.filter((a) => !isAttacker(state, a));
  const mainSite = Math.random() < 0.5 ? 'A' : 'B';
  const otherSite = mainSite === 'A' ? 'B' : 'A';
  atk.forEach((a, i) => {
    if (!a.brain) return;
    a.brain.site = i < 3 ? mainSite : otherSite;
    a.brain.role = a.hasBomb ? 'carrier' : 'atkPush';
    a.brain.holdPoint = null;
    a.brain.threwUtility = false;
  });
  const holds = { A: holdPoints('A'), B: holdPoints('B'), mid: holdPoints('mid') };
  def.forEach((a, i) => {
    if (!a.brain) return;
    const zone = i < 2 ? 'A' : i < 4 ? 'B' : 'mid';
    a.brain.site = zone === 'mid' ? (Math.random() < 0.5 ? 'A' : 'B') : zone;
    a.brain.role = 'hold';
    const pts = holds[zone];
    a.brain.holdPoint = pts[i % pts.length];
    a.brain.holdCrouch = Math.random() < 0.4;
    a.brain.threwUtility = false;
  });
}

const _eyeA = { x: 0, y: 0, z: 0 };
const _eyeB = { x: 0, y: 0, z: 0 };

function perceive(state, actor, brain) {
  brain.seen = null;
  if (state.time < actor.blindUntil) return;
  eyePos(actor, _eyeA);
  let bestDist = Infinity;
  for (const e of state.actors) {
    if (!e.alive || e.crew === actor.crew) continue;
    const dx = e.pos.x - actor.pos.x, dz = e.pos.z - actor.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 70 || dist >= bestDist) continue;
    if (dist > 3.5) {
      const fx = -Math.sin(actor.yaw), fz = -Math.cos(actor.yaw);
      if ((fx * dx + fz * dz) / (dist || 1) < BOT.fovCos) continue;
    }
    eyePos(e, _eyeB);
    if (!lineOfSight(state, _eyeA.x, _eyeA.y - 0.25, _eyeA.z, _eyeB.x, _eyeB.y - 0.25, _eyeB.z)) continue;
    bestDist = dist;
    brain.seen = e;
  }
  if (brain.seen) {
    if (!brain.wasSeen) { brain.aimSince = state.time; brain.wasSeen = true; }
    brain.seenAt = state.time;
    brain.lastKnown = { x: brain.seen.pos.x, z: brain.seen.pos.z, at: state.time };
  } else {
    brain.wasSeen = false;
    // hearing: fresh enemy noise inside its radius localises roughly
    for (const n of state.noises) {
      if (n.byCrew === actor.crew || state.time - n.at > 0.6) continue;
      const d = Math.hypot(n.x - actor.pos.x, n.z - actor.pos.z);
      if (d < n.radius) brain.lastKnown = { x: n.x, z: n.z, at: n.at };
    }
  }
}

function setPathTo(state, actor, brain, target) {
  const goalKey = `${Math.round(target.x)},${Math.round(target.z)}`;
  if (brain.pathGoal === goalKey && brain.pathIdx < brain.path.length) return;
  const path = findPath(actor.pos, target);
  brain.path = path || [];
  brain.pathIdx = 0;
  brain.pathGoal = goalKey;
  brain.repathAt = state.time + 2.5;
}

function followPath(state, actor, brain, dt, speed) {
  let tx = null, tz = null;
  while (brain.pathIdx < brain.path.length) {
    const wp = brain.path[brain.pathIdx];
    const d = Math.hypot(wp.x - actor.pos.x, wp.z - actor.pos.z);
    if (d < 1.3) { brain.pathIdx++; continue; }
    tx = wp.x; tz = wp.z; break;
  }
  if (tx === null) { actor.wish.x = 0; actor.wish.z = 0; return false; }
  const dx = tx - actor.pos.x, dz = tz - actor.pos.z;
  const l = Math.hypot(dx, dz) || 1;
  actor.wish.x = dx / l; actor.wish.z = dz / l;
  actor.wishSpeed = speed;
  // face the walk direction when not fighting
  if (!brain.seen) {
    const want = Math.atan2(-actor.wish.x, -actor.wish.z);
    actor.yaw = turnToward(actor.yaw, want, dt * 7);
  }
  // stuck detection: wishing to move but barely moving
  if (actor.speedNow < 0.35 && speed > 0) {
    if (state.time - brain.stuckAt > 1.4) { brain.pathGoal = null; brain.stuckAt = state.time; }
  } else brain.stuckAt = state.time;
  return true;
}

export function turnToward(cur, want, maxStep) {
  let d = want - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cur + Math.max(-maxStep, Math.min(maxStep, d));
}

function engage(state, actor, brain, dt) {
  const e = brain.seen;
  const dist = Math.hypot(e.pos.x - actor.pos.x, e.pos.z - actor.pos.z);
  // aim at the chest, drifting to the head as the aim settles
  const settle = Math.min(1, (state.time - brain.aimSince) / brain.reaction);
  const err = BOT.aimError * (1 - settle * 0.6) * (1 + e.speedNow * 0.22);
  const aimY = 1.05 + settle * 0.45;
  const tx = e.pos.x + Math.sin(state.time * 1.7 + actor.id) * err * dist;
  const tz = e.pos.z + Math.cos(state.time * 1.3 + actor.id * 2) * err * dist;
  const ang = lookAngles(actor.pos, EYE_STAND - (actor.crouch ? 0.5 : 0), tx, aimY, tz);
  actor.yaw = turnToward(actor.yaw, ang.yaw, dt * 10);
  actor.pitch = turnToward(actor.pitch, ang.pitch, dt * 10);
  // strafe while fighting; close in only when the enemy is far
  if (state.time > brain.strafeFlipAt) {
    brain.strafeDir = Math.random() < 0.5 ? -1 : 1;
    brain.strafeFlipAt = state.time + 0.6 + Math.random() * 0.9;
  }
  const fx = -Math.sin(actor.yaw), fz = -Math.cos(actor.yaw);
  const px = -fz * brain.strafeDir, pz = fx * brain.strafeDir;
  const approach = dist > 26 ? 0.45 : 0;
  actor.wish.x = px + fx * approach;
  actor.wish.z = pz + fz * approach;
  const wl = Math.hypot(actor.wish.x, actor.wish.z) || 1;
  actor.wish.x /= wl; actor.wish.z /= wl;
  actor.wishSpeed = WALK_SPEED * 0.82;
  actor.crouch = dist > 18 && settle > 0.7;
  // burst fire once settled
  if (settle >= 1 && state.time > brain.nextBurstAt) {
    brain.burstUntil = state.time + 0.16 + Math.random() * 0.3;
    brain.nextBurstAt = brain.burstUntil + BOT.burstPause[0] + Math.random() * (BOT.burstPause[1] - BOT.burstPause[0]);
  }
  actor.trigger = state.time < brain.burstUntil;
  if (actor[actor.current].mag === 0) actor.wantReload = true;
}

export function stepBot(state, actor, dt) {
  const brain = actor.brain;
  actor.trigger = false;
  actor.wish.x = 0; actor.wish.z = 0; actor.wishSpeed = 0;
  actor.crouch = false;
  actor.channel = null;      // re-asserted below only while truly channelling
  if (!actor.alive || state.phase === 'freeze' || state.phase === 'lobby') return;
  if (state.time >= brain.nextThink) {
    brain.nextThink = state.time + BOT.thinkInterval;
    perceive(state, actor, brain);
  } else if (brain.seen && !brain.seen.alive) brain.seen = null;

  const blind = state.time < actor.blindUntil;
  if (brain.seen && !blind) { engage(state, actor, brain, dt); return; }
  if (blind) { // stumble sideways, weapon down
    actor.wish.x = Math.sin(state.time * 0.9 + actor.id);
    actor.wish.z = Math.cos(state.time * 0.8 + actor.id);
    actor.wishSpeed = SNEAK_SPEED;
    return;
  }

  const atk = isAttacker(state, actor);
  const bomb = state.bomb;
  // ---- objective decisions
  if (bomb.state === 'planted') {
    if (!atk) {
      const d = Math.hypot(bomb.pos.x - actor.pos.x, bomb.pos.z - actor.pos.z);
      if (d < 1.6) { actor.channel = 'defuse'; return; }
      setPathTo(state, actor, brain, bomb.pos);
      followPath(state, actor, brain, dt, WALK_SPEED);
      return;
    }
    // attackers guard the pack from just off the site
    const d = Math.hypot(bomb.pos.x - actor.pos.x, bomb.pos.z - actor.pos.z);
    if (d > 9) { setPathTo(state, actor, brain, bomb.pos); followPath(state, actor, brain, dt, WALK_SPEED); }
    else actor.crouch = brain.holdCrouch;
    return;
  }
  if (atk) {
    if (actor.hasBomb) {
      const site = SITES[brain.site];
      if (siteAt(actor.pos) === brain.site) {
        actor.channel = 'plant';
        actor.yaw = turnToward(actor.yaw, Math.atan2(-(site.x - actor.pos.x), -(site.z - actor.pos.z)), dt * 5);
        return;
      }
      if (!brain.threwUtility && actor.grenades.smoke > 0) {
        const d = Math.hypot(site.x - actor.pos.x, site.z - actor.pos.z);
        if (d < 17) { brain.threwUtility = true; faceSite(actor, site); throwGrenade(state, actor, 'smoke'); }
      }
      setPathTo(state, actor, brain, site);
      followPath(state, actor, brain, dt, WALK_SPEED);
      return;
    }
    if (bomb.state === 'dropped') {
      setPathTo(state, actor, brain, bomb.pos);
      followPath(state, actor, brain, dt, WALK_SPEED);
      return;
    }
    // escort: move with the carrier's site, then hold its edge
    const site = SITES[brain.site];
    const d = Math.hypot(site.x - actor.pos.x, site.z - actor.pos.z);
    if (d > 10) { setPathTo(state, actor, brain, site); followPath(state, actor, brain, dt, WALK_SPEED); }
    else if (brain.lastKnown && state.time - brain.lastKnown.at < 4) {
      setPathTo(state, actor, brain, brain.lastKnown);
      followPath(state, actor, brain, dt, SNEAK_SPEED);
    } else actor.crouch = brain.holdCrouch;
    return;
  }
  // ---- defenders, bomb not planted: react to contact, else hold
  if (brain.lastKnown && state.time - brain.lastKnown.at < 3.5) {
    setPathTo(state, actor, brain, brain.lastKnown);
    followPath(state, actor, brain, dt, SNEAK_SPEED);
    return;
  }
  const hp = brain.holdPoint || SITES[brain.site];
  const d = Math.hypot(hp.x - actor.pos.x, hp.z - actor.pos.z);
  if (d > 1.6) { setPathTo(state, actor, brain, hp); followPath(state, actor, brain, dt, WALK_SPEED); }
  else {
    actor.crouch = brain.holdCrouch;
    // watch the likeliest approach: toward mid / the site entrance
    const watch = SITES[brain.site];
    const want = Math.atan2(-(watch.x - actor.pos.x), -(watch.z - actor.pos.z)) + Math.sin(state.time * 0.35 + actor.id) * 0.5;
    actor.yaw = turnToward(actor.yaw, want, dt * 2.5);
  }
  // reload in quiet moments
  const inst = actor[actor.current];
  if (inst.mag < 8 && !brain.seen) actor.wantReload = true;
}

function faceSite(actor, site) {
  actor.yaw = Math.atan2(-(site.x - actor.pos.x), -(site.z - actor.pos.z));
  actor.pitch = 0.08;
}
