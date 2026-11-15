// HARBOURFALL — submission program for the make.fun threejs-fps-02 competition
// (Node 22, standard library only).
//
// The entry is HARBOURFALL, a round-based 5v5 tactical FPS built on Three.js:
// the Vipers attack and the Wardens defend across two bombsites, planting or
// defusing a detpack over a best-of-16 match with an MR8 side swap. The game
// itself is this directory's game/ folder — plain static files the browser
// loads as ES modules, with three.js vendored and wired through an import
// map, and the screenshots in screenshots/ are its cover and gallery images
// (the first by name is the cover).
//
// This program hands the entry in. It copies game/ and screenshots/ from
// beside this file into the output directory, then writes dossier.json — the
// summary the judge reads — with buildDossier from the vendored make.fun
// library (vendor/makefun-threejs.ts), under the kit's caps: text_max_bytes
// 163840, at most 4 screenshots of 262144 bytes each, and game/ capped at
// 993 files and 50331648 bytes. The output is deterministic: repeated runs
// produce a byte-identical dossier.json.
//
// Serve the game locally with `node serve.ts`, then open
// http://localhost:8080. Outside the grader's container, MAKEFUN_OUTPUT_DIR
// stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the bytes; the others refuse an entry the
// scorer would refuse (more than 4 screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of game
// files, in all: game/ counts beside /output's own 1000-entry cap, its screenshots/ and dossier.json).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: 163840, screenshots: { max: 4, max_bytes: 262144 }, game_max_files: 993, game_max_bytes: 50331648 }),
);
