// HARBOURFALL — input.js
// Raw keyboard and mouse state, nothing more: a key set, mouse buttons,
// accumulated look deltas and the pointer-lock plumbing. player.js and
// hud.js read this; the simulation never touches the DOM directly.

export const input = {
  keys: new Set(),
  mouseDown: false,
  lookDX: 0,
  lookDY: 0,
  locked: false,
  wheel: 0,
};

let canvasEl = null;

export function initInput(canvas, onLockChange) {
  canvasEl = canvas;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Tab') e.preventDefault();
    input.keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => input.keys.delete(e.code));
  window.addEventListener('blur', () => { input.keys.clear(); input.mouseDown = false; });
  canvas.addEventListener('mousedown', (e) => { if (e.button === 0) input.mouseDown = true; });
  window.addEventListener('mouseup', (e) => { if (e.button === 0) input.mouseDown = false; });
  window.addEventListener('mousemove', (e) => {
    if (!input.locked) return;
    input.lookDX += e.movementX || 0;
    input.lookDY += e.movementY || 0;
  });
  window.addEventListener('wheel', (e) => { input.wheel += Math.sign(e.deltaY); }, { passive: true });
  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === canvas;
    if (onLockChange) onLockChange(input.locked);
  });
}

export function requestLock() {
  if (canvasEl && !input.locked) canvasEl.requestPointerLock();
}
export function releaseLock() {
  if (input.locked) document.exitPointerLock();
}
// One-shot key test: true only on the step the key first goes down.
const prev = new Set();
export function keyPressed(code) {
  const down = input.keys.has(code);
  const was = prev.has(code);
  if (down) prev.add(code); else prev.delete(code);
  return down && !was;
}
export function consumeLook() {
  const dx = input.lookDX, dy = input.lookDY;
  input.lookDX = 0; input.lookDY = 0;
  return { dx, dy };
}
