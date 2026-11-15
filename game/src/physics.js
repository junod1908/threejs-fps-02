// HARBOURFALL — physics.js
// Movement and ray queries against the map's collision boxes. Actors are
// circles on the ground plane; bullets are rays tested against 3D boxes
// (so a low crate stops a crouched shot but not a standing one) and
// against actor capsules (a head sphere over a body segment).

import { colliders } from './map.js';
import { ACCEL, FRICTION, RADIUS, EYE_STAND, EYE_CROUCH } from './config.js';

// Move an actor for one fixed step. wish is a unit direction (or zero),
// maxSpeed the speed cap for this step. Acceleration and friction follow
// the classic arena model: stopping is quick, strafing keeps momentum,
// and running into a box slides along it.
export function moveActor(actor, wish, maxSpeed, dt) {
  const v = actor.vel;
  // friction first, then accelerate toward the wish velocity
  const speed = Math.hypot(v.x, v.z);
  if (speed > 0) {
    const drop = speed * FRICTION * dt;
    const scale = Math.max(0, speed - drop) / speed;
    v.x *= scale; v.z *= scale;
  }
  const wishVx = wish.x * maxSpeed, wishVz = wish.z * maxSpeed;
  const dvx = wishVx - v.x, dvz = wishVz - v.z;
  const dv = Math.hypot(dvx, dvz);
  const maxDv = ACCEL * dt;
  if (dv > 0) {
    const s = Math.min(1, maxDv / dv);
    v.x += dvx * s; v.z += dvz * s;
  }
  // integrate axis by axis so collisions slide
  actor.pos.x += v.x * dt;
  resolveCollisions(actor, 'x');
  actor.pos.z += v.z * dt;
  resolveCollisions(actor, 'z');
  actor.speedNow = Math.hypot(v.x, v.z);
}

function resolveCollisions(actor, axis) {
  const p = actor.pos;
  for (const col of colliders) {
    if (p.x > col.minX - RADIUS && p.x < col.maxX + RADIUS &&
        p.z > col.minZ - RADIUS && p.z < col.maxZ + RADIUS) {
      if (axis === 'x') {
        p.x = actor.vel.x > 0 ? col.minX - RADIUS : col.maxX + RADIUS;
        actor.vel.x = 0;
      } else {
        p.z = actor.vel.z > 0 ? col.minZ - RADIUS : col.maxZ + RADIUS;
        actor.vel.z = 0;
      }
    }
  }
}

export function eyeHeight(actor) {
  return actor.crouch ? EYE_CROUCH : EYE_STAND;
}
export function eyePos(actor, out) {
  out.x = actor.pos.x; out.y = eyeHeight(actor); out.z = actor.pos.z;
  return out;
}

// Ray vs the world's boxes. dir must be normalised. Returns the distance
// to the nearest hit, or Infinity. Slab test per box; the box top is its
// height, its bottom the ground.
export function raycastWorld(ox, oy, oz, dx, dy, dz, maxDist) {
  let best = maxDist;
  for (const col of colliders) {
    let tmin = 0, tmax = best;
    // X slab
    if (Math.abs(dx) < 1e-9) {
      if (ox < col.minX || ox > col.maxX) continue;
    } else {
      let t1 = (col.minX - ox) / dx, t2 = (col.maxX - ox) / dx;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    // Y slab (0..h)
    if (Math.abs(dy) < 1e-9) {
      if (oy < 0 || oy > col.h) continue;
    } else {
      let t1 = (0 - oy) / dy, t2 = (col.h - oy) / dy;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    // Z slab
    if (Math.abs(dz) < 1e-9) {
      if (oz < col.minZ || oz > col.maxZ) continue;
    } else {
      let t1 = (col.minZ - oz) / dz, t2 = (col.maxZ - oz) / dz;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    if (tmin < best) best = tmin;
  }
  return best;
}

// Ray vs one actor. Head: sphere at eye height, radius 0.21. Body: a
// vertical segment from 0.25 to eye-0.18 with radius 0.36. Returns
// {dist, head} for the closer part, or null.
const _seg = { x: 0, y: 0, z: 0 };
export function raycastActor(ox, oy, oz, dx, dy, dz, actor, maxDist) {
  const eye = eyeHeight(actor);
  // head sphere
  const hx = actor.pos.x, hy = eye + 0.13, hz = actor.pos.z;
  const lx = hx - ox, ly = hy - oy, lz = hz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  let headHit = null;
  if (tca > 0) {
    const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
    const r = 0.21;
    if (d2 < r * r) {
      const t = tca - Math.sqrt(r * r - d2);
      if (t > 0 && t < maxDist) headHit = { dist: t, head: true };
    }
  }
  // body segment (closest point between ray and the vertical segment)
  const y0 = 0.25, y1 = eye - 0.16, radius = 0.36;
  // sample the segment coarsely but exactly enough for a 0.36 radius:
  // solve by checking the closest approach in the XZ plane per height.
  let bodyHit = null;
  // The segment is vertical, so the ray's closest point to the axis line
  // in 3D: minimise over t of distance to (ax, clamp(oy+dy*t, y0, y1), az).
  let bestD2 = Infinity, bestT = -1;
  const steps = 6;
  for (let i = 0; i <= steps; i++) {
    const sy = y0 + (y1 - y0) * (i / steps);
    // t where the ray passes closest to the point (ax, sy, az) in the
    // plane sense: project onto the ray.
    const px = actor.pos.x - ox, pz = actor.pos.z - oz;
    const t = px * dx + (sy - oy) * dy + pz * dz;
    if (t < 0 || t > maxDist) continue;
    const cx = ox + dx * t, cy = oy + dy * t, cz = oz + dz * t;
    const ddx = cx - actor.pos.x, ddy = cy - sy, ddz = cz - actor.pos.z;
    const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
    if (d2 < bestD2) { bestD2 = d2; bestT = t; }
  }
  if (bestT > 0 && bestD2 < radius * radius) bodyHit = { dist: bestT, head: false };
  if (headHit && bodyHit) return headHit.dist < bodyHit.dist ? headHit : bodyHit;
  return headHit || bodyHit;
}

// Line of sight between two eye points, with smoke clouds blocking.
export function lineOfSight(state, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 0.001) return true;
  const wall = raycastWorld(ax, ay, az, dx / dist, dy / dist, dz / dist, dist);
  if (wall < dist - 0.05) return false;
  for (const s of state.smokes) {
    if (s.until < state.time) continue;
    // distance from the segment to the smoke centre (XZ, mid height)
    const t = Math.max(0, Math.min(1, ((s.x - ax) * dx + (s.z - az) * dz) / (dist * dist)));
    const px = ax + dx * t - s.x, pz = az + dz * t - s.z;
    if (px * px + pz * pz < s.r * s.r) return false;
  }
  return true;
}
