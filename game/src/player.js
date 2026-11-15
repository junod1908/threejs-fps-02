// HARBOURFALL — player.js
// The human controller: turns raw input into the same intents the bots
// set — a wish direction and speed, a look direction, a trigger, a bomb
// channel. Mouse look is yaw/pitch on the actor; movement is relative to
// it. Walking is silent, running makes noise the bots can hear.

import { WALK_SPEED, SNEAK_SPEED, CROUCH_SPEED } from './config.js';
import { input, consumeLook, keyPressed } from './input.js';
import { throwGrenade } from './weapons.js';
import { siteAt } from './map.js';
import { isAttacker } from './state.js';

const SENS = 0.0021;

export function stepPlayer(state, actor, dt) {
  actor.trigger = false;
  actor.wish.x = 0; actor.wish.z = 0; actor.wishSpeed = 0;
  actor.channel = null;
  if (!actor.alive || state.phase === 'lobby' || state.phase === 'matchEnd') return;

  const { dx, dy } = consumeLook();
  if (input.locked) {
    actor.yaw -= dx * SENS;
    actor.pitch -= dy * SENS;
    actor.pitch = Math.max(-1.45, Math.min(1.45, actor.pitch));
  }
  if (state.phase === 'freeze') return;   // buy phase: look, don't walk

  const k = input.keys;
  const fx = -Math.sin(actor.yaw), fz = -Math.cos(actor.yaw);
  const rx = Math.cos(actor.yaw), rz = -Math.sin(actor.yaw);
  let wx = 0, wz = 0;
  if (k.has('KeyW')) { wx += fx; wz += fz; }
  if (k.has('KeyS')) { wx -= fx; wz -= fz; }
  if (k.has('KeyD')) { wx += rx; wz += rz; }
  if (k.has('KeyA')) { wx -= rx; wz -= rz; }
  const len = Math.hypot(wx, wz);
  actor.crouch = k.has('ControlLeft') || k.has('KeyC');
  if (len > 0) {
    actor.wish.x = wx / len; actor.wish.z = wz / len;
    actor.wishSpeed = actor.crouch ? CROUCH_SPEED
      : k.has('ShiftLeft') ? SNEAK_SPEED : WALK_SPEED;
  }
  actor.trigger = input.mouseDown && input.locked;
  if (k.has('KeyR')) actor.wantReload = true;

  // weapon selection: 1 primary, 2 sidearm, Q swaps
  if (keyPressed('Digit1') && actor.primary) switchTo(actor, 'primary');
  if (keyPressed('Digit2')) switchTo(actor, 'sidearm');
  if (keyPressed('KeyQ')) switchTo(actor, actor.current === 'primary' ? 'sidearm' : 'primary');
  // grenades: 4 flash, 5 smoke
  if (keyPressed('Digit4')) throwGrenade(state, actor, 'flash');
  if (keyPressed('Digit5')) throwGrenade(state, actor, 'smoke');

  // bomb work: hold E near the objective
  if (k.has('KeyE')) {
    if (isAttacker(state, actor) && actor.hasBomb && siteAt(actor.pos)) actor.channel = 'plant';
    else if (!isAttacker(state, actor) && state.bomb.state === 'planted') {
      const d = Math.hypot(state.bomb.pos.x - actor.pos.x, state.bomb.pos.z - actor.pos.z);
      if (d < 2.1) actor.channel = 'defuse';
    }
  }
  // footsteps: running is audible, walking and crouching are not
  if (actor.speedNow > 3.4 && state.time - (actor.footstepAt || 0) > 0.34) {
    actor.footstepAt = state.time;
    state.noises.push({ x: actor.pos.x, z: actor.pos.z, radius: 7, at: state.time, byCrew: actor.crew });
  }
}

function switchTo(actor, slot) {
  if (!actor[slot] || actor.current === slot) return;
  actor.current = slot;
  actor.reloadUntil = 0;         // swapping cancels a reload
  actor.triggerHeld = false;
}
