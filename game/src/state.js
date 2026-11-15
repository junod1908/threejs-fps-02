// HARBOURFALL — state.js
// The whole mutable game state lives in one object built here, so every
// other module reads and writes the same place. Rendering objects (three.js
// meshes) are attached to actors but owned by main.js; this file stays
// free of three.js so the simulation could run headless.

import { START_MONEY } from './config.js';

let nextId = 1;

export function makeActor(name, crew, isHuman) {
  return {
    id: nextId++,
    name,
    crew,                    // 0 or 1 — the crew is permanent; roles swap
    isHuman,
    alive: true,
    hp: 100,
    armor: 0,                // 0 none, 1 vest, 2 vest + helmet
    money: START_MONEY,
    kills: 0,
    deaths: 0,
    // position is the feet centre; y is always 0 on this flat yard
    pos: { x: 0, z: 0 },
    vel: { x: 0, z: 0 },
    yaw: 0, pitch: 0,        // look direction (radians)
    crouch: false,
    speedNow: 0,             // metres/sec, for spread and footsteps
    // weapons: instances keyed by slot
    primary: null,           // weapon instance or null
    sidearm: makeWeapon('sidearm'),
    current: 'sidearm',
    grenades: { flash: 0, smoke: 0 },
    // combat timers
    reloadUntil: 0,
    nextShotAt: 0,
    trigger: false,          // wants to fire this step
    triggerHeld: false,      // semi-auto latch
    wantReload: false,
    bloom: 0,                // extra spread from recent shots
    recoilPitch: 0,          // accumulated aim kick, decays each step
    // movement intent, set by the human controller or the bot brain and
    // consumed by main.js through physics.moveActor
    wish: { x: 0, z: 0 },
    wishSpeed: 0,
    // bomb interaction: channel is the intent ('plant' | 'defuse'),
    // channelT the seconds of uninterrupted work so far
    channel: null,
    channelT: 0,
    hasBomb: false,
    // perception / brain (bots; the human uses the same fields in shot mode)
    brain: null,
    lastSeenEnemyAt: -99,
    lastHeardAt: -99,
    blindUntil: 0,
    // render handles, set by main.js
    mesh: null,
    nameSprite: null,
  };
}

export function makeWeapon(key) {
  return { key, mag: 0, reserve: 0 };    // filled by round.js on spawn/buy
}

export function createState() {
  nextId = 1;
  return {
    time: 0,                 // simulation clock (seconds, fixed steps)
    phase: 'lobby',          // lobby|freeze|live|planted|roundEnd|matchEnd
    round: 0,                // 1-based once the match starts
    phaseEndsAt: 0,
    roundTimer: 0,
    crews: [
      { score: 0, lossStreak: 0 },
      { score: 0, lossStreak: 0 },
    ],
    actors: [],              // 10 actors, index 0 is the human
    human: null,
    bomb: {
      state: 'carried',      // carried|dropped|planted|exploded|defused
      carrier: null,
      pos: { x: 0, z: 0 },
      site: null,            // 'A' or 'B' once planted
      plantedAt: 0,
      mesh: null,
    },
    // transient effects the renderer/audio drain each frame
    events: [],              // {type:'shot'|'hit'|'kill'|'boom'|...}
    noises: [],              // {x, z, radius, at, byCrew} gunfire & steps
    smokes: [],              // {x, z, r, until} vision blockers
    grenadesLive: [],        // thrown grenades in flight (weapons.js)
    killfeed: [],            // {killer, victim, weapon, head, at}
    banner: null,            // {title, sub, until} centre-screen message
    winner: null,            // crew index once the match ends
    roundResult: null,       // {crew, how} for the round that just ended
    stats: { shots: 0, hits: 0 },
  };
}

// The crew index that is attacking this round: crew 0 attacks the first
// half, crew 1 the second. Rounds are 1-based.
export function attackingCrew(state) {
  return state.round <= 8 ? 0 : 1;
}
export function isAttacker(state, actor) {
  return actor.crew === attackingCrew(state);
}
export function aliveActors(state, crew) {
  return state.actors.filter((a) => a.alive && (crew === undefined || a.crew === crew));
}
export function pushEvent(state, type, data) {
  state.events.push({ type, at: state.time, ...data });
}
