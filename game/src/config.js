// HARBOURFALL — config.js
// Every tuning constant for the game lives here: timings, economy, weapons,
// bot skill and the dusk-harbour palette. No logic, no imports.

// ---------------------------------------------------------------- timings
export const SIM_DT = 1 / 60;            // fixed simulation step (seconds)
export const FREEZE_TIME = 12;           // buy phase at the start of a round
export const ROUND_TIME = 100;           // live round clock
export const BOMB_TIME = 35;             // detpack fuse after a plant
export const PLANT_TIME = 3.2;           // channel time to plant
export const DEFUSE_TIME = 5;            // channel time to defuse
export const ROUND_END_TIME = 5;         // pause on the round result
export const ROUNDS_TO_WIN = 9;          // MR8: first to 9, swap after 8
export const MAX_ROUNDS = 16;
export const SWAP_ROUND = 8;

// ---------------------------------------------------------------- economy
export const START_MONEY = 800;
export const MONEY_CAP = 16000;
export const REWARD_KILL = 300;
export const REWARD_PLANT = 800;         // team bonus when the pack goes down
export const REWARD_PLANTER = 300;       // extra for the planter
export const REWARD_WIN_ELIM = 3250;
export const REWARD_WIN_OBJECTIVE = 3500;
export const REWARD_LOSS_BASE = 1400;    // +500 per consecutive loss, capped
export const REWARD_LOSS_STEP = 500;
export const REWARD_LOSS_MAX = 2900;

// ---------------------------------------------------------------- weapons
// damage is per bullet at point blank; headMult multiplies a head hit;
// falloff is the fraction of damage kept per 10 m past rangeStart.
export const WEAPONS = {
  sidearm: {
    name: 'P9 Sidearm', slot: 'sidearm', price: 0, auto: false,
    damage: 26, headMult: 3.2, rpm: 380, mag: 12, reserve: 96,
    reload: 1.6, spread: 0.011, moveSpread: 2.6, recoil: 0.55,
    rangeStart: 14, falloff: 0.86, tracer: 0xbfe3ff,
  },
  smg: {
    name: 'Raptor SMG', slot: 'primary', price: 1250, auto: true,
    damage: 22, headMult: 3.0, rpm: 800, mag: 32, reserve: 128,
    reload: 2.2, spread: 0.02, moveSpread: 3.2, recoil: 0.34,
    rangeStart: 10, falloff: 0.8, tracer: 0xffd9a0,
  },
  scatter: {
    name: 'Mule Scattergun', slot: 'primary', price: 1100, auto: false,
    damage: 11, headMult: 2.0, rpm: 68, mag: 6, reserve: 36, pellets: 8,
    reload: 2.9, spread: 0.055, moveSpread: 2.2, recoil: 2.4,
    rangeStart: 6, falloff: 0.62, tracer: 0xffb37a,
  },
  rifle: {
    name: 'VK-7 Rifle', slot: 'primary', price: 2700, auto: true,
    damage: 34, headMult: 4.0, rpm: 600, mag: 30, reserve: 120,
    reload: 2.4, spread: 0.013, moveSpread: 3.4, recoil: 0.62,
    rangeStart: 22, falloff: 0.92, tracer: 0xffe9b0,
  },
  longshot: {
    name: 'Longshot DMR', slot: 'primary', price: 3400, auto: false,
    damage: 72, headMult: 2.6, rpm: 165, mag: 10, reserve: 50,
    reload: 2.7, spread: 0.0025, moveSpread: 4.2, recoil: 1.7,
    rangeStart: 40, falloff: 0.97, tracer: 0xff9d7a,
  },
};
export const BUY_ITEMS = [
  { key: 'smg', label: 'Raptor SMG', price: 1250, hint: 'Fast, loose, close range' },
  { key: 'scatter', label: 'Mule Scattergun', price: 1100, hint: 'Eight pellets, one argument' },
  { key: 'rifle', label: 'VK-7 Rifle', price: 2700, hint: 'The yard standard' },
  { key: 'longshot', label: 'Longshot DMR', price: 3400, hint: 'One tap down the lanes' },
  { key: 'armor', label: 'Kevlar Vest', price: 650, hint: 'Halves bullet damage' },
  { key: 'armorhelm', label: 'Vest + Helmet', price: 1000, hint: 'Armour, head included' },
  { key: 'flash', label: 'Flash Grenade', price: 200, hint: 'Blinds whoever looks' },
  { key: 'smoke', label: 'Smoke Grenade', price: 300, hint: 'Seven seconds of nowhere' },
];

// ---------------------------------------------------------------- actors
export const TEAM_NAMES = ['Vipers', 'Wardens'];       // crew 0 attacks first
export const ROLE_NAMES = ['Attackers', 'Defenders'];
export const BOT_NAMES = [
  'Moss', 'Quill', 'Havel', 'Sable', 'Rook', 'Tarn', 'Vex', 'Ondo', 'Pell', 'Ash',
];
export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.12;
export const RADIUS = 0.38;              // actor collision radius (m)
export const WALK_SPEED = 4.6;
export const SNEAK_SPEED = 2.4;
export const CROUCH_SPEED = 2.1;
export const ACCEL = 42;                 // ground acceleration (m/s^2)
export const FRICTION = 10;              // ground friction (1/s)

// ---------------------------------------------------------------- bots
export const BOT = {
  thinkInterval: 0.12,                   // seconds between decisions
  reaction: [0.28, 0.55],                // aim-settle time range (s)
  fovCos: -0.35,                         // ~200 degree peripheral cone
  hearGunfire: 34,                       // metres
  hearFootstep: 7,
  burstPause: [0.09, 0.22],              // pause between bursts
  aimError: 0.028,                       // radians of aim noise at best
};

// ---------------------------------------------------------------- palette
// Dusk over a container terminal: slate blue darks, sodium-lamp amber,
// container teal and rust, one signal red for the pack.
export const PALETTE = {
  sky: 0x1a2230,
  fog: 0x232f42,
  ground: '#3d4148',
  wall: '#565d66',
  wallDark: '#434a53',
  crate: '#7a5c38',
  containers: ['#2e6f6a', '#8a4a2b', '#33506e', '#6e3a3a', '#4a6741', '#77683a'],
  siteA: '#e08a2e',
  siteB: '#2ea8e0',
  atk: 0xe08a2e,                         // Vipers amber
  def: 0x3fa7d6,                         // Wardens blue
  lamp: 0xffb45e,
};
