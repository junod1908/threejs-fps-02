// HARBOURFALL — main.js
// Boot and the frame loop. The simulation advances in fixed steps
// (SIM_DT) behind an accumulator; rendering reads whatever the last step
// left. This file owns the three.js scene, the actor meshes and the
// first-person viewmodel, drains the state's event list into sound and
// effects, and stages the deterministic scenes the screenshots use.

import * as THREE from 'three';
import { SIM_DT, BOT_NAMES, TEAM_NAMES, EYE_STAND } from './config.js';
import { createState, makeActor } from './state.js';
import { buildMap, buildBombMesh, SITES } from './map.js';
import { moveActor, eyeHeight } from './physics.js';
import { refillWeapon, stepWeapon, stepGrenades } from './weapons.js';
import { makeBrain, stepBot } from './bots.js';
import { startMatch, stepRound, buyItem } from './round.js';
import { stepPlayer } from './player.js';
import {
  initHud, updateHud, showHitmarker, showDamageFrom, flashScreen,
  showOverlay, hideOverlay,
} from './hud.js';
import { initFx, updateFx, spawnTracer, spawnSparks, spawnMuzzle, spawnSmoke, spawnExplosion } from './fx.js';
import {
  initAudio, resumeAudio, sndShot, sndReload, sndDryFire, sndHit, sndHurt,
  sndKill, sndBeep, sndPlant, sndBoom, sndFlash, sndRoundWin, sndRoundLose, sndBuy,
} from './audio.js';
import { initInput, input, requestLock } from './input.js';

// ------------------------------------------------------------ setup
const params = new URLSearchParams(location.search);
const shotMode = params.get('shot');
if (params.has('seed')) {           // deterministic captures
  let s = (parseInt(params.get('seed'), 10) || 1) >>> 0;
  Math.random = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.22;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.08, 400);
buildMap(scene);
initFx(scene);

const state = createState();
const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
const human = makeActor('You', 0, true);
state.actors.push(human);
state.human = human;
for (let i = 0; i < 9; i++) {
  const crew = i < 4 ? 0 : 1;
  const bot = makeActor(names[i], crew, false);
  bot.brain = makeBrain();
  state.actors.push(bot);
}

// ------------------------------------------------------------ actor meshes
const crewMats = [
  new THREE.MeshStandardMaterial({ color: 0xc47b28, roughness: 0.7 }),
  new THREE.MeshStandardMaterial({ color: 0x2f7ea6, roughness: 0.7 }),
];
const darkMat = new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.85 });
const skinMat = new THREE.MeshStandardMaterial({ color: 0xc9a183, roughness: 0.8 });

function nameSprite(actor) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 56;
  const ctx = cv.getContext('2d');
  ctx.font = 'bold 30px system-ui';
  ctx.textAlign = 'center';
  ctx.fillStyle = actor.crew === 0 ? '#ffb45e' : '#7ec8ee';
  ctx.strokeStyle = 'rgba(0,0,0,0.65)'; ctx.lineWidth = 6;
  ctx.strokeText(actor.name, 128, 38);
  ctx.fillText(actor.name, 128, 38);
  const tex = new THREE.CanvasTexture(cv);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  spr.scale.set(2.3, 0.5, 1);
  spr.position.y = 2.12;
  return spr;
}

function buildActorMesh(actor) {
  const g = new THREE.Group();
  const body = new THREE.Group();
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.78, 0.28), darkMat);
  legs.position.y = 0.39;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 0.32), crewMats[actor.crew]);
  torso.position.y = 1.13;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.34, 0.32), skinMat);
  head.position.y = 1.68;
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.1, 0.36), crewMats[actor.crew]);
  cap.position.y = 1.88;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.78), darkMat);
  gun.position.set(0.24, 1.32, -0.42);
  for (const m of [legs, torso, head, cap, gun]) { m.castShadow = true; body.add(m); }
  g.add(body);
  const sprite = nameSprite(actor);
  g.add(sprite);
  g.userData = { body, sprite, gun };
  scene.add(g);
  actor.mesh = g;
  actor.nameSprite = sprite;
}
for (const a of state.actors) buildActorMesh(a);
human.mesh.visible = false;

const bombMesh = buildBombMesh();
scene.add(bombMesh);

// grenades in flight: a small pool of dark spheres
const nadeMeshes = [];
for (let i = 0; i < 6; i++) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), darkMat);
  m.visible = false;
  scene.add(m);
  nadeMeshes.push(m);
}

// ------------------------------------------------------------ viewmodel
const viewmodel = new THREE.Group();
const vmGun = new THREE.Group();
{
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.16, 0.62), darkMat);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 6), darkMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.05, -0.42);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.1), darkMat);
  mag.position.set(0, -0.16, -0.05);
  vmGun.add(body, barrel, mag);
  vmGun.position.set(0.24, -0.22, -0.45);
  viewmodel.add(vmGun);
}
camera.add(viewmodel);
scene.add(camera);

// ------------------------------------------------------------ hud & flow
initHud((key) => { if (buyItem(state, human, key)) sndBuy(); });
initInput(renderer.domElement, (locked) => {
  if (!locked && !shotMode && (state.phase !== 'lobby' && state.phase !== 'matchEnd')) {
    showOverlay('Paused', 'The match is waiting. Click to jump back in.', 'Resume');
  }
});
const ovButton = document.getElementById('ovButton');
function beginPlay() {
  initAudio();
  resumeAudio();
  hideOverlay();
  if (state.phase === 'lobby' || state.phase === 'matchEnd') startMatch(state);
  requestLock();
}
ovButton.addEventListener('click', beginPlay);
showOverlay(
  'HARBOURFALL',
  'Vipers against Wardens in the Kestrel Yard: plant the detpack on a cargo site, or hold the yard against it. Sixteen rounds, sides swap at the half, first to nine.',
  'Click to play',
);
if (shotMode) stageShot(shotMode);

// ------------------------------------------------------------ staging (?shot=)
// Deterministic scenes for the maker's screenshots: the match is started,
// the human is driven by a bot brain, and each scene is posed mid-story.
function stageShot(kind) {
  hideOverlay();
  human.brain = makeBrain();
  startMatch(state);
  if (kind === 'start') {
    human.money = 4200;
    place(human, -32, 22, 0.35);
    state.phaseEndsAt = state.time + 999;      // hold the buy phase open
  } else if (kind === 'play') {
    state.crews[0].score = 2; state.crews[1].score = 1;
    state.round = 4;
    giveRifle(human);
    place(human, 0, 10, 0.15);
    const foes = state.actors.filter((a) => a.crew === 1);
    place(foes[0], -2, -2, 3.0); place(foes[1], 6, -6, 3.1); place(foes[2], -9, 2, 2.6);
    const mates = state.actors.filter((a) => a.crew === 0 && a !== human);
    place(mates[0], 3, 16, 0.2); place(mates[1], -4, 18, 0.9);
    state.phase = 'live';
    state.phaseEndsAt = state.time + 47;
  } else if (kind === 'site') {
    state.crews[0].score = 4; state.crews[1].score = 3;
    state.round = 8;
    giveRifle(human);
    const b = state.bomb;
    b.state = 'planted'; b.site = 'A';
    b.pos = { x: SITES.A.x, z: SITES.A.z };
    if (b.carrier) b.carrier.hasBomb = false;
    b.carrier = null;
    human.hasBomb = false;
    place(human, SITES.A.x - 3, SITES.A.z + 4, -0.6);
    const foes = state.actors.filter((a) => a.crew === 1);
    place(foes[0], SITES.A.x - 6, SITES.A.z - 3, 0.8);
    place(foes[1], SITES.A.x + 2, SITES.A.z + 11, 2.4);
    state.phase = 'planted';
    state.phaseEndsAt = state.time + 24;
  } else if (kind === 'end') {
    state.crews[0].score = 9; state.crews[1].score = 6;
    state.round = 15;
    state.phase = 'matchEnd';
    state.winner = 0;
    human.kills = 14; human.deaths = 7;
    showOverlay('VICTORY — VIPERS 9 · 6 WARDENS', 'The yard is yours. Final scoreboard below; click to run it back.', 'Play again');
  }
  let frames = 0;
  const mark = () => { if (++frames > 70) window.__shotReady = true; else requestAnimationFrame(mark); };
  requestAnimationFrame(mark);
}
function giveRifle(actor) {
  actor.primary = { key: 'rifle', mag: 0, reserve: 0 };
  refillWeapon(actor.primary);
  actor.current = 'primary';
  actor.armor = 2;
  actor.money = 3350;
  actor.grenades.flash = 1;
  actor.grenades.smoke = 1;
}
function place(actor, x, z, yaw) {
  actor.pos.x = x; actor.pos.z = z;
  actor.vel.x = 0; actor.vel.z = 0;
  actor.yaw = yaw;
}

// ------------------------------------------------------------ events
let shake = 0;
function drainEvents() {
  for (const ev of state.events) {
    const actor = state.actors[ev.by];
    switch (ev.type) {
      case 'shot': {
        if (actor) {
          actor.lastShotAt = state.time;
          const d = Math.hypot(ev.x - human.pos.x, ev.z - human.pos.z);
          if (ev.by !== human.id) sndShot(ev.weapon, d);
          const e = { x: actor.pos.x, y: 0, z: actor.pos.z };
          spawnMuzzle(e.x - Math.sin(actor.yaw) * 0.6, eyeHeight(actor) - 0.12, e.z - Math.cos(actor.yaw) * 0.6);
        }
        break;
      }
      case 'tracer':
        spawnTracer(ev.x1, ev.y1, ev.z1, ev.x2, ev.y2, ev.z2, ev.color);
        if (ev.wall) spawnSparks(ev.x2, ev.y2, ev.z2, 4);
        break;
      case 'hit': {
        if (ev.by === human.id) { showHitmarker(ev.head); sndHit(ev.head); }
        if (ev.victim === human.id) {
          const shooter = state.actors[ev.by];
          if (shooter) {
            const ang = Math.atan2(shooter.pos.x - human.pos.x, shooter.pos.z - human.pos.z) + human.yaw + Math.PI;
            showDamageFrom(ang);
          }
          sndHurt();
        }
        spawnSparks(ev.x, 1.2, ev.z, 5);
        break;
      }
      case 'kill':
        if (ev.victim === human.id) shake = Math.max(shake, 0.35);
        if (ev.by === human.id) sndKill();
        break;
      case 'explosion':
        spawnExplosion(ev.x, ev.z); sndBoom();
        shake = Math.max(shake, Math.max(0, 1 - Math.hypot(ev.x - human.pos.x, ev.z - human.pos.z) / 30));
        break;
      case 'smoke': spawnSmoke(ev.x, ev.z); break;
      case 'flashbang': sndFlash(); break;
      case 'blinded': flashScreen(ev.strength); break;
      case 'reload': if (ev.by === human.id) sndReload(); break;
      case 'dry': if (ev.by === human.id) sndDryFire(); break;
      case 'planted': sndPlant(); break;
      case 'beep': sndBeep(ev.final); break;
      case 'roundEnd':
        if (ev.crew === human.crew) sndRoundWin(); else sndRoundLose();
        break;
      case 'matchEnd':
        showOverlay(
          ev.winner === -1 ? 'DRAWN — 8 · 8' : ev.winner === human.crew ? 'VICTORY' : 'DEFEAT',
          `Final: Vipers ${state.crews[0].score} · ${state.crews[1].score} Wardens.`,
          'Play again',
        );
        document.exitPointerLock?.();
        break;
    }
  }
  state.events.length = 0;
}

// ------------------------------------------------------------ the loop
function stepSim(dt) {
  state.time += dt;
  // intents
  for (const a of state.actors) {
    if (a === human && !shotMode) stepPlayer(state, a, dt);
    else if (a.brain) stepBot(state, a, dt);
  }
  stepRound(state, dt);
  for (const a of state.actors) {
    if (a.alive && a.wishSpeed > 0) moveActor(a, a.wish, a.wishSpeed, dt);
    else { a.vel.x = 0; a.vel.z = 0; a.speedNow = 0; }
    if (state.phase === 'live' || state.phase === 'planted') stepWeapon(state, a, dt);
  }
  stepGrenades(state, dt);
  // prune stale noises once a step
  for (let i = state.noises.length - 1; i >= 0; i--) {
    if (state.time - state.noises[i].at > 1) state.noises.splice(i, 1);
  }
}

function syncMeshes() {
  for (const a of state.actors) {
    const g = a.mesh;
    if (!g) continue;
    if (a === human) { g.visible = false; continue; }
    g.visible = true;
    g.position.set(a.pos.x, 0, a.pos.z);
    g.rotation.y = -a.yaw;
    const body = g.userData.body;
    body.position.y = a.crouch ? -0.34 : 0;
    body.rotation.x = a.alive ? 0 : Math.PI / 2 - 0.12;
    body.position.z = a.alive ? 0 : -0.4;
    g.userData.sprite.visible = a.alive;
    const gun = g.userData.gun;
    gun.rotation.x = -a.pitch;
    gun.visible = a.alive;
  }
  // the pack follows its carrier's back, or lies where it fell
  const b = state.bomb;
  if (b.state === 'carried' && b.carrier) {
    const c = b.carrier;
    bombMesh.visible = c !== human;
    bombMesh.position.set(c.pos.x + Math.sin(c.yaw) * 0.3, 1.25, c.pos.z + Math.cos(c.yaw) * 0.3);
  } else if (b.state === 'dropped' || b.state === 'planted') {
    bombMesh.visible = true;
    bombMesh.position.set(b.pos.x, 0, b.pos.z);
  } else bombMesh.visible = false;
  bombMesh.userData.beacon.material.color.setHex(
    b.state === 'planted' && Math.floor(state.time * (state.phaseEndsAt - state.time < 10 ? 6 : 2)) % 2 ? 0xff2a1a : 0x661008,
  );
  state.grenadesLive.forEach((n, i) => {
    const m = nadeMeshes[i];
    if (!m) return;
    m.visible = true;
    m.position.set(n.x, n.y, n.z);
  });
  for (let i = state.grenadesLive.length; i < nadeMeshes.length; i++) nadeMeshes[i].visible = false;
}

function updateCamera() {
  let view = human;
  if (!human.alive) {
    view = state.actors.find((a) => a.alive && a.crew === human.crew) || human;
  }
  camera.position.set(view.pos.x, eyeHeight(view), view.pos.z);
  const pitch = view.pitch + (view === human ? (human.recoilPitch || 0) * 0.55 : 0);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = view.yaw;
  camera.rotation.x = pitch;
  if (shake > 0.002) {
    camera.rotation.z = (Math.random() - 0.5) * shake * 0.05;
    camera.position.y += (Math.random() - 0.5) * shake * 0.05;
  } else camera.rotation.z = 0;
  // viewmodel: bob with movement, dip while reloading, kick on shots
  const h = human;
  const bob = Math.min(1, h.speedNow / 4) * 0.016;
  vmGun.position.y = -0.22 + Math.sin(performance.now() * 0.011) * bob - (h.reloadUntil > state.time ? 0.13 : 0);
  vmGun.position.z = -0.45 + (h.recoilPitch || 0) * 0.35;
  vmGun.rotation.x = (h.recoilPitch || 0) * 0.8 - (h.reloadUntil > state.time ? 0.5 : 0);
  viewmodel.visible = h.alive && view === human;
}

let last = performance.now();
let acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let delta = Math.min(0.1, (now - last) / 1000);
  last = now;
  const paused = !shotMode && !input.locked && state.phase !== 'lobby' && state.phase !== 'matchEnd';
  if (!paused && state.phase !== 'lobby') {
    acc += delta;
    while (acc >= SIM_DT) { stepSim(SIM_DT); acc -= SIM_DT; }
  }
  shake = Math.max(0, shake - delta * 1.6);
  drainEvents();
  syncMeshes();
  updateCamera();
  updateFx();
  updateHud(state);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
