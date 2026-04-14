import { useEffect, useRef, useState } from "react";

// ── Constants ────────────────────────────────────────────────────────────────
const TILES_W = 120,
  TILES_H = 40;
const TS = 32; // tile size px
const WORLD_W = TILES_W * TS; // 3840
const WORLD_H = TILES_H * TS; // 1280
const SURFACE = 8; // surface tile row
const CW = 800,
  CH = 480; // canvas size

const GRAVITY = 0.55,
  JUMP_FORCE = -13,
  MOVE_SPEED = 4.2,
  FRICTION = 0.8;
const CAM_LERP = 0.1;
const MINE_REACH = TS * 3; // px reach

const CONFETTI = [
  "#FF6B6B",
  "#FFD93D",
  "#6BCB77",
  "#4D96FF",
  "#FF922B",
  "#CC5DE8",
  "#F06595",
];

// ── Tile IDs ─────────────────────────────────────────────────────────────────
const T = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  COAL: 4,
  IRON: 5,
  DIAMOND: 6,
  BEDROCK: 7,
  WOOD: 8,
  LEAVES: 9,
  GRAVEL: 10,
} as const;
type TId = (typeof T)[keyof typeof T];

// ── Mining time (frames at 60fps) ────────────────────────────────────────────
const MINE_FRAMES: Partial<Record<number, number>> = {
  [T.GRASS]: 20,
  [T.DIRT]: 20,
  [T.STONE]: 70,
  [T.COAL]: 82,
  [T.IRON]: 100,
  [T.DIAMOND]: 145,
  [T.WOOD]: 40,
  [T.LEAVES]: 6,
  [T.GRAVEL]: 20,
  [T.BEDROCK]: Infinity,
};

// ── Item drops per tile ───────────────────────────────────────────────────────
const TILE_DROP: Partial<Record<number, string>> = {
  [T.GRASS]: "dirt",
  [T.DIRT]: "dirt",
  [T.STONE]: "stone",
  [T.COAL]: "coal",
  [T.IRON]: "iron",
  [T.DIAMOND]: "diamond",
  [T.WOOD]: "wood",
  [T.LEAVES]: "leaves",
  [T.GRAVEL]: "gravel",
};

// ── Item metadata ─────────────────────────────────────────────────────────────
const ITEMS: Record<string, { col: string; label: string; placeTile?: TId }> = {
  dirt: { col: "#8B6347", label: "Dirt", placeTile: T.DIRT },
  stone: { col: "#888888", label: "Stone", placeTile: T.STONE },
  coal: { col: "#222222", label: "Coal" },
  iron: { col: "#C89060", label: "Iron" },
  diamond: { col: "#00BCD4", label: "Diamond" },
  wood: { col: "#A0522D", label: "Wood", placeTile: T.WOOD },
  leaves: { col: "#2D7A2D", label: "Leaves", placeTile: T.LEAVES },
  gravel: { col: "#777777", label: "Gravel", placeTile: T.GRAVEL },
  apple: { col: "#E74C3C", label: "Apple 🍎" },
};

// ── Types ─────────────────────────────────────────────────────────────────────
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  col: string;
  life: number;
  size: number;
}
interface Drop {
  id: string;
  x: number;
  y: number;
  vy: number;
  bob: number;
  dead: boolean;
}
interface Slot {
  id: string;
  count: number;
}
interface Mob {
  kind: "wolf" | "pig" | "creeper";
  x: number;
  y: number;
  vy: number;
  dir: 1 | -1;
  active: boolean;
  triggered: boolean;
  exploded: boolean;
  flash: boolean;
  walkDelay: number;
  startX: number;
  tamed: boolean;
  heartTimer: number;
}

// ── Dialogues ─────────────────────────────────────────────────────────────────
const DLGS: Record<string, string> = {
  wolf: "I'm sort of a lone wolf. But, \n you're my best friend and I love sharing and doing things with you. \n As Rocky said..\"is not enough\" how much time we get to spend together.",
  pig: "I'm really proud of the boy that you are becoming,\n and I'm genuinely impressed by how smart you are.",
  diamond:
    "You have a really kind heart and big dreams. \n I can't tell you all that because I can't risk losing aura points \n plis understand.",
  creeper:
    "I love how much we match each other's freak..\n I love who I can be with you..",
};

const ENDING_TEXT = `Happy 17th Birthday, Saksham.

From all the small moments to the big ones,
you've been more than just a brother —
you've been my constant.

This little world is just a glimpse
of the adventures ahead of you.

Keep exploring. Keep building.
Keep being you.

I'll always be cheering for you.

🎉 Happy Birthday 🎉`;

// ── Story positions (rescaled for 120-tile world) ────────────────────────────
const CHEST_X = 3450,
  CHEST_Y = (SURFACE - 1) * TS;
const STORY_DIA_ROW = SURFACE + 8,
  STORY_DIA_COL = Math.floor(1450 / TS); // x≈1450, 8 tiles deep

// ── World generation ─────────────────────────────────────────────────────────
function generateWorld(): TId[][] {
  const w: TId[][] = [];
  for (let row = 0; row < TILES_H; row++) {
    w[row] = [];
    for (let col = 0; col < TILES_W; col++) {
      if (row < SURFACE) {
        w[row][col] = T.AIR;
      } else if (row === SURFACE) {
        w[row][col] = T.GRASS;
      } else if (row < SURFACE + 4) {
        w[row][col] = T.DIRT;
      } else if (row >= TILES_H - 3) {
        w[row][col] = T.BEDROCK;
      } else {
        const depth = row - SURFACE - 4;
        const r = Math.random();
        if (depth > 22 && r < 0.018) w[row][col] = T.DIAMOND;
        else if (depth > 12 && r < 0.04) w[row][col] = T.IRON;
        else if (depth > 4 && r < 0.07) w[row][col] = T.COAL;
        else if (depth > 0 && r < 0.04) w[row][col] = T.GRAVEL;
        else w[row][col] = T.STONE;
      }
    }
  }

  // Guaranteed story diamond block — place it and one extra beside it
  if (STORY_DIA_ROW < TILES_H) {
    w[STORY_DIA_ROW][STORY_DIA_COL] = T.DIAMOND;
    w[STORY_DIA_ROW][STORY_DIA_COL + 1] = T.DIAMOND;
  }

  // Clear a 3-wide shaft from the surface down to the story diamond
  for (let r = SURFACE; r < STORY_DIA_ROW; r++) {
    w[r][STORY_DIA_COL - 1] = T.AIR;
    w[r][STORY_DIA_COL] = T.AIR;
    w[r][STORY_DIA_COL + 1] = T.AIR;
  }

  // Iron-block pillars on either side of shaft entrance so it's obvious
  w[SURFACE - 1][STORY_DIA_COL - 2] = T.IRON;
  w[SURFACE - 1][STORY_DIA_COL + 2] = T.IRON;
  w[SURFACE][STORY_DIA_COL - 2] = T.IRON;
  w[SURFACE][STORY_DIA_COL + 2] = T.IRON;

  // Trees — random spacing
  let col = 3;
  while (col < TILES_W - 4) {
    const h = 4 + Math.floor(Math.random() * 2);
    for (let r = SURFACE - h; r < SURFACE; r++) if (r >= 0) w[r][col] = T.WOOD;
    for (let dr = -(h + 2); dr <= -(h - 1); dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const r = SURFACE + dr,
          c = col + dc;
        if (r >= 0 && r < TILES_H && c >= 0 && c < TILES_W && w[r][c] === T.AIR)
          w[r][c] = T.LEAVES;
      }
    }
    col += 7 + Math.floor(Math.random() * 5);
  }

  // Clear player spawn area
  for (let r = 0; r < SURFACE; r++) for (let c = 0; c < 4; c++) w[r][c] = T.AIR;

  return w;
}

// ── Tile solidity ─────────────────────────────────────────────────────────────
// Leaves and air are non-solid — player walks through them freely
const NON_SOLID = new Set<TId>([T.AIR, T.LEAVES]);

function isSolid(w: TId[][], tx: number, ty: number): boolean {
  if (tx < 0 || tx >= TILES_W || ty >= TILES_H) return true;
  if (ty < 0) return false;
  return !NON_SOLID.has(w[ty][tx]);
}

// ── Tile drawing ──────────────────────────────────────────────────────────────
function drawTile(
  ctx: CanvasRenderingContext2D,
  id: TId,
  sx: number,
  sy: number,
) {
  const x = Math.round(sx),
    y = Math.round(sy),
    s = TS;
  switch (id) {
    case T.GRASS:
      ctx.fillStyle = "#8B6347";
      ctx.fillRect(x, y, s, s);
      ctx.fillStyle = "#5A9E44";
      ctx.fillRect(x, y, s, 8);
      ctx.fillStyle = "#6DBF47";
      ctx.fillRect(x, y, s, 2);
      ctx.fillStyle = "#7A5533";
      ctx.fillRect(x + 8, y + 14, 4, 2);
      ctx.fillRect(x + 20, y + 22, 4, 2);
      break;
    case T.DIRT:
      ctx.fillStyle = "#8B6347";
      ctx.fillRect(x, y, s, s);
      ctx.fillStyle = "#7A5533";
      ctx.fillRect(x + 6, y + 8, 4, 2);
      ctx.fillRect(x + 18, y + 18, 5, 2);
      ctx.fillRect(x + 8, y + 24, 4, 2);
      break;
    case T.STONE:
      ctx.fillStyle = "#888";
      ctx.fillRect(x, y, s, s);
      ctx.fillStyle = "#999";
      ctx.fillRect(x + 1, y + 1, s / 2 - 2, s / 2 - 2);
      ctx.fillRect(x + s / 2 + 1, y + s / 2 + 1, s / 2 - 2, s / 2 - 2);
      ctx.fillStyle = "#777";
      ctx.fillRect(x, y + s / 2, s, 1);
      ctx.fillRect(x + s / 2, y, 1, s);
      break;
    case T.COAL:
      ctx.fillStyle = "#888";
      ctx.fillRect(x, y, s, s);
      ctx.fillStyle = "#1a1a1a";
      ctx.fillRect(x + 6, y + 6, 8, 6);
      ctx.fillRect(x + 16, y + 14, 8, 5);
      ctx.fillRect(x + 8, y + 20, 6, 4);
      break;
    case T.IRON:
      ctx.fillStyle = "#888";
      ctx.fillRect(x, y, s, s);
      ctx.fillStyle = "#C89060";
      ctx.fillRect(x + 4, y + 4, 8, 8);
      ctx.fillRect(x + 16, y + 12, 9, 8);
      ctx.fillRect(x + 6, y + 20, 8, 6);
      break;
    case T.DIAMOND:
      ctx.fillStyle = "#888";
      ctx.fillRect(x, y, s, s);
      ctx.fillStyle = "#00BCD4";
      ctx.fillRect(x + 4, y + 8, 8, 6);
      ctx.fillRect(x + 16, y + 6, 8, 6);
      ctx.fillRect(x + 10, y + 18, 6, 8);
      ctx.fillStyle = "#80DEEA";
      ctx.fillRect(x + 6, y + 10, 2, 2);
      ctx.fillRect(x + 18, y + 8, 2, 2);
      ctx.fillRect(x + 12, y + 20, 2, 2);
      break;
    case T.BEDROCK:
      ctx.fillStyle = "#333";
      ctx.fillRect(x, y, s, s);
      ctx.fillStyle = "#555";
      ctx.fillRect(x + 4, y + 4, 8, 8);
      ctx.fillRect(x + 18, y + 16, 8, 8);
      ctx.fillStyle = "#222";
      ctx.fillRect(x + 14, y + 2, 6, 6);
      ctx.fillRect(x + 2, y + 20, 8, 6);
      break;
    case T.WOOD:
      ctx.fillStyle = "#6B3A2A";
      ctx.fillRect(x, y, s, s);
      ctx.fillStyle = "#8B4513";
      ctx.fillRect(x + 4, y, s - 8, s);
      ctx.fillStyle = "#A0522D";
      ctx.fillRect(x + 8, y, s - 16, s);
      ctx.fillStyle = "#5a3020";
      ctx.fillRect(x, y + 8, s, 1);
      ctx.fillRect(x, y + 16, s, 1);
      ctx.fillRect(x, y + 24, s, 1);
      break;
    case T.LEAVES:
      ctx.fillStyle = "#2D7A2D";
      ctx.fillRect(x, y, s, s);
      ctx.fillStyle = "#3A9E3A";
      ctx.fillRect(x + 4, y + 2, 8, 6);
      ctx.fillRect(x + 2, y + 10, 10, 5);
      ctx.fillRect(x + 16, y + 4, 10, 6);
      ctx.fillStyle = "#1E5C1E";
      ctx.fillRect(x + 14, y + 22, 8, 6);
      ctx.fillRect(x + 4, y + 20, 8, 4);
      break;
    case T.GRAVEL:
      ctx.fillStyle = "#777";
      ctx.fillRect(x, y, s, s);
      ctx.fillStyle = "#999";
      ctx.fillRect(x + 4, y + 4, 6, 6);
      ctx.fillRect(x + 18, y + 8, 6, 6);
      ctx.fillRect(x + 8, y + 18, 6, 6);
      ctx.fillStyle = "#555";
      ctx.fillRect(x + 12, y + 2, 4, 4);
      ctx.fillRect(x + 2, y + 16, 6, 4);
      break;
  }
  ctx.strokeStyle = "rgba(0,0,0,0.12)";
  ctx.lineWidth = 0.5;
  ctx.strokeRect(x, y, s, s);
}

// ── Character drawing helpers ─────────────────────────────────────────────────
function drawPlayer(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  right: boolean,
  heldItem?: string,
) {
  const px = Math.round(x),
    py = Math.round(y);
  ctx.save();
  ctx.translate(px + 14, py);
  ctx.scale(right ? 1 : -1, 1);
  ctx.translate(-14, 0);
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.beginPath();
  ctx.ellipse(14, 42, 12, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#4A90D9";
  ctx.fillRect(6, 28, 8, 12);
  ctx.fillStyle = "#357ABD";
  ctx.fillRect(14, 28, 8, 12);
  ctx.fillStyle = "#333";
  ctx.fillRect(5, 38, 9, 5);
  ctx.fillStyle = "#222";
  ctx.fillRect(13, 38, 9, 5);
  ctx.fillStyle = "#5BAD6F";
  ctx.fillRect(4, 14, 20, 16);
  ctx.fillStyle = "#5BAD6F";
  ctx.fillRect(0, 14, 5, 12);
  ctx.fillRect(23, 14, 5, 12);
  ctx.fillStyle = "#F5C5A3";
  ctx.fillRect(5, 1, 18, 14);
  ctx.fillStyle = "#333";
  ctx.fillRect(9, 6, 3, 3);
  ctx.fillRect(16, 6, 3, 3);
  ctx.fillStyle = "#5C3317";
  ctx.fillRect(5, 1, 18, 4);
  ctx.fillStyle = "#C8956C";
  ctx.fillRect(12, 11, 6, 2);
  // Held item in right arm
  if (heldItem && ITEMS[heldItem]) {
    ctx.fillStyle = ITEMS[heldItem].col;
    ctx.fillRect(23, 16, 10, 8);
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.fillRect(24, 17, 4, 3);
  }
  ctx.restore();
}

function drawWolf(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const px = Math.round(x),
    py = Math.round(y);
  ctx.fillStyle = "#888";
  ctx.fillRect(px, py + 8, 30, 20);
  ctx.fillStyle = "#999";
  ctx.fillRect(px + 5, py, 22, 18);
  ctx.fillStyle = "#888";
  ctx.fillRect(px + 6, py - 6, 6, 8);
  ctx.fillRect(px + 18, py - 6, 6, 8);
  ctx.fillStyle = "#FF9900";
  ctx.fillRect(px + 10, py + 5, 4, 4);
  ctx.fillRect(px + 20, py + 5, 4, 4);
  ctx.fillStyle = "#bbb";
  ctx.fillRect(px + 10, py + 11, 12, 6);
  ctx.fillStyle = "#555";
  ctx.fillRect(px + 14, py + 10, 4, 3);
  ctx.fillStyle = "#888";
  ctx.fillRect(px - 6, py + 10, 8, 6);
  ctx.fillRect(px + 3, py + 26, 6, 10);
  ctx.fillRect(px + 12, py + 26, 6, 10);
  ctx.fillRect(px + 21, py + 26, 6, 10);
  ctx.fillStyle = "#bbb";
  ctx.fillRect(px - 8, py + 6, 6, 6);
}

function drawPig(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const px = Math.round(x),
    py = Math.round(y);
  ctx.fillStyle = "#FFB3C6";
  ctx.fillRect(px, py + 6, 32, 22);
  ctx.fillStyle = "#FFC2D4";
  ctx.fillRect(px + 4, py, 24, 20);
  ctx.fillStyle = "#FF8FAB";
  ctx.fillRect(px + 4, py - 5, 7, 8);
  ctx.fillRect(px + 21, py - 5, 7, 8);
  ctx.fillStyle = "#333";
  ctx.fillRect(px + 9, py + 5, 4, 4);
  ctx.fillRect(px + 20, py + 5, 4, 4);
  ctx.fillStyle = "#FF8FAB";
  ctx.fillRect(px + 9, py + 11, 14, 8);
  ctx.fillStyle = "#CC6688";
  ctx.fillRect(px + 11, py + 13, 3, 3);
  ctx.fillRect(px + 18, py + 13, 3, 3);
  ctx.fillStyle = "#FFB3C6";
  ctx.fillRect(px + 4, py + 26, 6, 8);
  ctx.fillRect(px + 12, py + 26, 6, 8);
  ctx.fillRect(px + 20, py + 26, 6, 8);
}

function drawCreeper(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  flash: boolean,
) {
  const px = Math.round(x),
    py = Math.round(y);
  const b = flash ? "#aaffaa" : "#4CAF50";
  const f = flash ? "#fff" : "#1B5E20";
  ctx.fillStyle = b;
  ctx.fillRect(px + 4, py + 14, 20, 26);
  ctx.fillRect(px, py, 28, 28);
  ctx.fillStyle = f;
  ctx.fillRect(px + 4, py + 8, 8, 8);
  ctx.fillRect(px + 16, py + 8, 8, 8);
  ctx.fillRect(px + 8, py + 18, 4, 4);
  ctx.fillRect(px + 16, py + 18, 4, 4);
  ctx.fillRect(px + 8, py + 22, 12, 4);
  ctx.fillStyle = b;
  ctx.fillRect(px + 4, py + 38, 8, 8);
  ctx.fillRect(px + 16, py + 38, 8, 8);
}

function drawChest(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  open: number,
) {
  const px = Math.round(x),
    py = Math.round(y);
  ctx.fillStyle = "#8B4513";
  ctx.fillRect(px, py + 16, 40, 24);
  ctx.fillStyle = "#A0522D";
  ctx.fillRect(px + 2, py + 18, 36, 20);
  ctx.fillStyle = "#DAA520";
  ctx.fillRect(px + 16, py + 24, 8, 8);
  ctx.save();
  ctx.translate(px, py + 16);
  ctx.rotate(-open * 0.9);
  ctx.fillStyle = "#6B3310";
  ctx.fillRect(0, -16, 40, 16);
  ctx.fillStyle = "#8B4513";
  ctx.fillRect(2, -14, 36, 12);
  ctx.restore();
  if (open > 0.4) {
    ctx.save();
    ctx.globalAlpha = ((open - 0.4) / 0.6) * 0.8;
    const g = ctx.createRadialGradient(
      px + 20,
      py + 16,
      0,
      px + 20,
      py + 16,
      70,
    );
    g.addColorStop(0, "#FFD700");
    g.addColorStop(1, "rgba(255,215,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(px - 50, py - 50, 140, 120);
    ctx.restore();
  }
}

function drawCloud(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.beginPath();
  ctx.arc(x + 30, y + 20, 20, 0, Math.PI * 2);
  ctx.arc(x + 55, y + 15, 25, 0, Math.PI * 2);
  ctx.arc(x + 80, y + 20, 20, 0, Math.PI * 2);
  ctx.arc(x + 20, y + 30, 15, 0, Math.PI * 2);
  ctx.arc(x + 90, y + 30, 15, 0, Math.PI * 2);
  ctx.fill();
}

// ── Audio Engine — C418-inspired ──────────────────────────────────────────────
let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let reverbNode: ConvolverNode | null = null;
let musicPaused = false;
let musicTimer: ReturnType<typeof setTimeout> | null = null;
let bgRunning = false;

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new AudioContext();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.7;
    masterGain.connect(audioCtx.destination);
    buildReverb();
  }
  return audioCtx;
}
function getMaster() {
  getAudioCtx();
  return masterGain!;
}
function getReverb() {
  getAudioCtx();
  return reverbNode;
}

function buildReverb() {
  if (!audioCtx) return;
  const cv = audioCtx.createConvolver();
  const rate = audioCtx.sampleRate,
    len = rate * 2.8;
  const buf = audioCtx.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < len; i++)
      ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
  }
  cv.buffer = buf;
  reverbNode = cv;
  reverbNode.connect(masterGain!);
}

function playPianoAt(
  freq: number,
  when: number,
  vol: number,
  dur: number,
  wet: number,
) {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator(),
      h2 = ctx.createOscillator();
    const dg = ctx.createGain(),
      hg = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, when);
    h2.type = "sine";
    h2.frequency.setValueAtTime(freq * 2, when);
    hg.gain.value = 0.1;
    dg.gain.setValueAtTime(0, when);
    dg.gain.linearRampToValueAtTime(vol, when + 0.015);
    dg.gain.exponentialRampToValueAtTime(vol * 0.35, when + 0.25);
    dg.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(dg);
    h2.connect(hg);
    hg.connect(dg);
    dg.connect(getMaster());
    if (wet > 0 && getReverb()) {
      const wg = ctx.createGain();
      wg.gain.value = vol * wet;
      wg.gain.setValueAtTime(vol * wet, when);
      wg.gain.exponentialRampToValueAtTime(0.0001, when + dur + 1.8);
      dg.connect(wg);
      wg.connect(getReverb()!);
    }
    osc.start(when);
    osc.stop(when + dur + 0.1);
    h2.start(when);
    h2.stop(when + dur + 0.1);
  } catch (_) {}
}

function playPiano(freq: number, dur: number, vol = 0.17, wet = 0.4) {
  const ctx = getAudioCtx();
  playPianoAt(freq, ctx.currentTime, vol, dur, wet);
}

function playJump() {
  try {
    const ctx = getAudioCtx(),
      osc = ctx.createOscillator(),
      g = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(200, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(380, ctx.currentTime + 0.08);
    g.gain.setValueAtTime(0.07, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.connect(g);
    g.connect(getMaster());
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch (_) {}
}

function playMineHit() {
  try {
    const ctx = getAudioCtx(),
      osc = ctx.createOscillator(),
      g = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(80 + Math.random() * 40, ctx.currentTime);
    g.gain.setValueAtTime(0.04, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
    osc.connect(g);
    g.connect(getMaster());
    osc.start();
    osc.stop(ctx.currentTime + 0.06);
  } catch (_) {}
}

function playBlockBreak() {
  [120, 90].forEach((f, i) =>
    setTimeout(() => {
      try {
        const ctx = getAudioCtx(),
          osc = ctx.createOscillator(),
          g = ctx.createGain();
        osc.type = "square";
        osc.frequency.setValueAtTime(f, ctx.currentTime);
        g.gain.setValueAtTime(0.06, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
        osc.connect(g);
        g.connect(getMaster());
        osc.start();
        osc.stop(ctx.currentTime + 0.09);
      } catch (_) {}
    }, i * 40),
  );
}

function playCollectItem() {
  playPiano(1047, 0.2, 0.12, 0.3);
  setTimeout(() => playPiano(1318, 0.15, 0.1, 0.3), 70);
}

function playWolfCue() {
  [
    [440, 0],
    [349, 0.5],
    [330, 0.9],
    [293, 1.35],
    [262, 1.8],
    [220, 2.4],
  ].forEach(([f, d]) =>
    setTimeout(() => playPiano(f, 1.2, 0.14, 0.5), d * 1000),
  );
}
function playPigCue() {
  [
    [523, 0],
    [659, 0.18],
    [784, 0.36],
    [1047, 0.54],
    [784, 0.8],
    [659, 1.0],
    [523, 1.2],
  ].forEach(([f, d]) =>
    setTimeout(() => playPiano(f, 0.6, 0.14, 0.3), d * 1000),
  );
}
function playDiamondCue() {
  [
    [1046, 0],
    [1318, 0.12],
    [1568, 0.24],
    [2093, 0.4],
    [1568, 0.65],
    [1318, 0.85],
    [1046, 1.05],
    [2093, 1.3],
  ].forEach(([f, d]) =>
    setTimeout(() => playPiano(f, 0.8, 0.13, 0.6), d * 1000),
  );
}
function playCreeperHiss() {
  try {
    const ctx = getAudioCtx(),
      buf = ctx.createBuffer(1, ctx.sampleRate * 0.8, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++)
      data[i] = (Math.random() * 2 - 1) * 0.25;
    const src = ctx.createBufferSource(),
      filt = ctx.createBiquadFilter(),
      g = ctx.createGain();
    src.buffer = buf;
    filt.type = "bandpass";
    filt.frequency.value = 1200;
    filt.Q.value = 0.8;
    g.gain.setValueAtTime(0.5, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
    src.connect(filt);
    filt.connect(g);
    g.connect(getMaster());
    src.start();
    src.stop(ctx.currentTime + 0.85);
  } catch (_) {}
}
function playCreeperPop() {
  try {
    const ctx = getAudioCtx(),
      osc = ctx.createOscillator(),
      g = ctx.createGain(),
      now = ctx.currentTime;
    osc.type = "sine";
    osc.frequency.setValueAtTime(80, now);
    osc.frequency.exponentialRampToValueAtTime(30, now + 0.4);
    g.gain.setValueAtTime(0.5, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc.connect(g);
    g.connect(getMaster());
    osc.start(now);
    osc.stop(now + 0.55);
  } catch (_) {}
  [1046, 1318, 1568, 2093, 1760, 2349].forEach((f, i) =>
    setTimeout(() => playPiano(f, 0.4, 0.12, 0.4), i * 60 + 80),
  );
}
function playChestOpen() {
  [
    [392, 0],
    [523, 0.12],
    [659, 0.24],
    [784, 0.38],
    [1046, 0.55],
    [784, 0.9],
    [987, 0.9],
    [1318, 0.9],
    [1568, 1.1],
  ].forEach(([f, d]) =>
    setTimeout(() => playPiano(f, 1.4, 0.13, 0.55), d * 1000),
  );
}

// Background music phrases
type BgNote = [number, number, number, number];
const BG_PHRASES: BgNote[][] = [
  [
    [261, 0, 0.14, 2],
    [329, 0.6, 0.12, 1.8],
    [391, 1.1, 0.13, 1.6],
    [329, 1.7, 0.1, 1.5],
    [293, 2.2, 0.11, 1.8],
    [261, 2.9, 0.13, 2.2],
  ],
  [
    [329, 0, 0.12, 1.8],
    [391, 0.7, 0.14, 2],
    [440, 1.3, 0.13, 1.6],
    [523, 2.0, 0.15, 2.2],
    [440, 2.8, 0.1, 1.4],
    [391, 3.4, 0.11, 1.6],
  ],
  [
    [523, 0, 0.13, 2],
    [493, 0.8, 0.1, 1.5],
    [440, 1.5, 0.11, 1.4],
    [391, 2.1, 0.09, 1.6],
    [329, 2.7, 0.1, 1.8],
    [261, 4.0, 0.12, 2.5],
  ],
  [
    [293, 0, 0.1, 1.6],
    [349, 0.6, 0.12, 1.8],
    [440, 1.2, 0.14, 2],
    [523, 1.9, 0.13, 1.7],
    [493, 2.6, 0.1, 1.5],
    [391, 3.7, 0.09, 1.8],
    [329, 4.3, 0.11, 2.2],
  ],
];
let phraseIdx = 0;

function schedulePhrase() {
  if (!bgRunning || musicPaused) {
    musicTimer = setTimeout(schedulePhrase, 400);
    return;
  }
  const phrase = BG_PHRASES[phraseIdx++ % BG_PHRASES.length];
  let maxEnd = 0;
  try {
    const ctx = getAudioCtx(),
      now = ctx.currentTime;
    phrase.forEach(([freq, delay, vol, dur]) => {
      playPianoAt(freq, now + delay, vol, dur + 0.5, 0.5);
      if (delay + dur > maxEnd) maxEnd = delay + dur;
    });
  } catch (_) {}
  musicTimer = setTimeout(
    schedulePhrase,
    (maxEnd + 1.5 + Math.random() * 2) * 1000,
  );
}

function startMusic() {
  if (bgRunning) return;
  bgRunning = true;
  musicPaused = false;
  getAudioCtx();
  schedulePhrase();
}
function pauseMusic() {
  musicPaused = true;
}
function resumeMusic() {
  musicPaused = false;
}

// ── Title screen ─────────────────────────────────────────────────────────────
const TITLE_STARS = Array.from({ length: 60 }, () => ({
  x: Math.random() * CW,
  y: 60 + Math.random() * (CH - 100),
  b: Math.random() * Math.PI * 2,
}));

function renderTitle(ctx: CanvasRenderingContext2D) {
  const now = Date.now();

  // Night-sky gradient
  const grad = ctx.createLinearGradient(0, 0, 0, CH);
  grad.addColorStop(0, "#060618");
  grad.addColorStop(1, "#0a0a2e");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CW, CH);

  // Twinkling stars
  for (const star of TITLE_STARS) {
    const bright = (Math.sin(now / 1200 + star.b) + 1) / 2;
    ctx.fillStyle = `rgba(255,255,255,${0.2 + bright * 0.8})`;
    ctx.fillRect(
      Math.round(star.x),
      Math.round(star.y),
      bright > 0.7 ? 2 : 1,
      bright > 0.7 ? 2 : 1,
    );
  }

  // Scrolling tile row at the very top
  const tilePan = Math.floor(now / 90) % TS;
  const tileRow: TId[] = [
    T.GRASS,
    T.DIRT,
    T.STONE,
    T.COAL,
    T.IRON,
    T.DIAMOND,
    T.WOOD,
    T.LEAVES,
  ];
  for (let i = -1; i < CW / TS + 1; i++)
    drawTile(
      ctx,
      tileRow[(i + Math.floor(now / 700)) % tileRow.length],
      i * TS - tilePan,
      0,
    );
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(0, 0, CW, TS);

  // "Happy 17th Birthday!" header
  ctx.save();
  ctx.shadowColor = "#FFD700";
  ctx.shadowBlur = 22;
  ctx.fillStyle = "#FFD700";
  ctx.font = "bold 22px monospace";
  ctx.textAlign = "center";
  ctx.fillText("🎂  Happy 17th Birthday!  🎂", CW / 2, 66);
  ctx.restore();

  // Name glow
  ctx.save();
  ctx.shadowColor = "#88DDFF";
  ctx.shadowBlur = 36;
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "bold 52px monospace";
  ctx.textAlign = "center";
  ctx.fillText("Saksham", CW / 2, 126);
  ctx.restore();

  ctx.fillStyle = "#7ECEF4";
  ctx.font = "12px monospace";
  ctx.textAlign = "center";
  ctx.fillText("A Minecraft-style birthday adventure  ⛏", CW / 2, 150);

  // Bobbing Steve character
  const steveY = 164 + Math.sin(now / 700) * 7;
  drawPlayer(ctx, CW / 2 - 14, steveY, true);

  // Controls / How-to-play panel
  const px = CW / 2 - 198,
    py = 216,
    pw = 396,
    ph = 182;
  ctx.fillStyle = "rgba(0,0,0,0.75)";
  ctx.fillRect(px, py, pw, ph);
  ctx.strokeStyle = "#555";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(px, py, pw, ph);
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 1;
  ctx.strokeRect(px + 1, py + 1, pw - 2, ph - 2);

  ctx.fillStyle = "#FFD700";
  ctx.font = "bold 13px monospace";
  ctx.textAlign = "left";
  ctx.fillText("⌨  How to Play", px + 14, py + 22);

  const controls: [string, string][] = [
    ["← → / A D", "Move left and right"],
    ["Space / ↑ / W", "Jump"],
    ["Click + hold", "Mine a block (watch progress bar)"],
    ["Right-click", "Place block from hotbar"],
    ["Keys 1–9 / Q / E", "Switch hotbar slot"],
    ["⛏ button", "Mine on mobile"],
    ["Walk right →", "Discover the story…"],
  ];
  controls.forEach(([key, desc], i) => {
    ctx.fillStyle = "#E8CC6A";
    ctx.font = "bold 11px monospace";
    ctx.fillText(key, px + 14, py + 44 + i * 19);
    ctx.fillStyle = "#bbb";
    ctx.font = "11px monospace";
    ctx.fillText(desc, px + 168, py + 44 + i * 19);
  });

  // Blinking prompt
  if (Math.floor(now / 550) % 2 === 0) {
    ctx.save();
    ctx.shadowColor = "#FFD700";
    ctx.shadowBlur = 16;
    ctx.fillStyle = "#FFD700";
    ctx.font = "bold 17px monospace";
    ctx.textAlign = "center";
    ctx.fillText("▶  Press ENTER (or tap) to Play", CW / 2, CH - 12);
    ctx.restore();
  }
}

// ── Main Game Component ───────────────────────────────────────────────────────
type GState = "playing" | "creeper_chase" | "chest_open" | "ending";

export default function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const started = useRef(false);
  const endingStarted = useRef(false);

  const [overlayText, setOverlayText] = useState("");
  const [overlayOn, setOverlayOn] = useState(false);
  const [endingLines, setEndingLines] = useState<string[]>([]);
  const [showReplay, setShowReplay] = useState(false);
  const [hotbarState, setHotbarState] = useState<(Slot | null)[]>(
    Array(9).fill(null),
  );
  const [selSlot, setSelSlot] = useState(0);
  const [achievement, setAchievement] = useState<{
    icon: string;
    title: string;
    sub: string;
  } | null>(null);
  const [titlePhase, setTitlePhase] = useState(true);

  const sr = useRef({
    // World
    world: generateWorld(),

    // Player
    px: 60,
    py: (SURFACE - 1) * TS - 44,
    pvx: 0,
    pvy: 0,
    onGround: false,
    facingRight: true,

    // Mining
    mineActive: false,
    mineTargetX: -1,
    mineTargetY: -1,
    mineProgress: 0,
    mineHitTimer: 0,
    mobileMining: false,

    // Placing
    mobilePlace: false,

    // Mouse
    mouseWorldX: 0,
    mouseWorldY: 0,
    mouseDown: false,
    rightMouseDown: false,

    // Camera
    camX: 0,
    camY: (SURFACE - 4) * TS,

    // Inventory (9 slots)
    hotbar: Array(9).fill(null) as (Slot | null)[],
    selSlot: 0,

    // Drops
    drops: [] as Drop[],

    // Particles
    particles: [] as Particle[],

    // Mobs — rescaled to 120-tile world
    mobs: [
      {
        kind: "wolf",
        x: 380,
        y: (SURFACE - 1) * TS - 36,
        vy: 0,
        dir: -1 as 1 | -1,
        active: true,
        triggered: false,
        exploded: false,
        flash: false,
        walkDelay: 0,
        startX: 380,
        tamed: false,
        heartTimer: 0,
      },
      {
        kind: "pig",
        x: 900,
        y: (SURFACE - 1) * TS - 34,
        vy: 0,
        dir: 1 as 1 | -1,
        active: true,
        triggered: false,
        exploded: false,
        flash: false,
        walkDelay: 0,
        startX: 900,
        tamed: false,
        heartTimer: 0,
      },
      {
        kind: "creeper",
        x: 2250,
        y: (SURFACE - 1) * TS - 46,
        vy: 0,
        dir: 1 as 1 | -1,
        active: true,
        triggered: false,
        exploded: false,
        flash: false,
        walkDelay: 100,
        startX: 2250,
        tamed: false,
        heartTimer: 0,
      },
    ] as Mob[],

    // Story
    storyTriggered: {} as Record<string, boolean>,
    diamondMined: false,
    chestOpen: 0,
    gameState: "playing" as GState,
    shakeX: 0,
    shakeY: 0,
    shakeTimer: 0,

    // Clouds
    clouds: Array.from({ length: 14 }, (_, i) => ({
      x: i * 480 + Math.random() * 200,
      y: 20 + Math.random() * 100,
      spd: 0.2 + Math.random() * 0.3,
    })),

    // Keys
    keys: {} as Record<string, boolean>,

    // Title / intro
    titlePhase: true,
    introDropping: false,
  });

  function addToInventory(id: string) {
    const h = sr.current.hotbar;
    const existing = h.findIndex((s) => s?.id === id);
    if (existing >= 0) {
      h[existing]!.count++;
    } else {
      const empty = h.findIndex((s) => s === null);
      if (empty >= 0) h[empty] = { id, count: 1 };
    }
    setHotbarState([...h]);
  }

  function spawnConfetti(cx: number, cy: number, n = 80) {
    const s = sr.current;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2,
        spd = 3 + Math.random() * 7;
      s.particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd - 4,
        col: CONFETTI[Math.floor(Math.random() * CONFETTI.length)],
        life: 1,
        size: 4 + Math.random() * 6,
      });
    }
  }

  function triggerShake(str = 5, dur = 20) {
    const s = sr.current;
    s.shakeTimer = dur;
    s.shakeX = str;
    s.shakeY = str;
  }

  function showDialogue(text: string, ms: number) {
    setOverlayText(text);
    setOverlayOn(true);
    setTimeout(() => setOverlayOn(false), ms);
  }

  function showAchievement(icon: string, title: string, sub: string) {
    setAchievement({ icon, title, sub });
    setTimeout(() => setAchievement(null), 3800);
  }

  function spawnHearts(cx: number, cy: number, n = 12) {
    const s = sr.current;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI;
      const spd = 1.5 + Math.random() * 2.5;
      s.particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd - 1.5,
        col: i % 3 === 0 ? "#FF69B4" : i % 3 === 1 ? "#FF1493" : "#FFB6C1",
        life: 1,
        size: 8 + Math.random() * 6,
      });
    }
  }

  function startEnding() {
    if (endingStarted.current) return;
    endingStarted.current = true;
    const lines = ENDING_TEXT.split("\n");
    let li = 0;
    const acc: string[] = [];
    function next() {
      if (li >= lines.length) {
        setTimeout(() => setShowReplay(true), 1500);
        return;
      }
      acc.push(lines[li]);
      setEndingLines([...acc]);
      li++;
      setTimeout(next, lines[li - 1].trim() === "" ? 500 : 1100);
    }
    setTimeout(next, 800);
  }

  function resetGame() {
    const s = sr.current;
    s.world = generateWorld();
    s.px = 60;
    s.py = (SURFACE - 1) * TS - 44;
    s.pvx = 0;
    s.pvy = 0;
    s.onGround = false;
    s.facingRight = true;
    s.mineActive = false;
    s.mineTargetX = -1;
    s.mineTargetY = -1;
    s.mineProgress = 0;
    s.mouseDown = false;
    s.rightMouseDown = false;
    s.camX = 0;
    s.camY = (SURFACE - 4) * TS;
    s.hotbar = Array(9).fill(null);
    s.selSlot = 0;
    s.drops = [];
    s.particles = [];
    s.mobs = [
      {
        kind: "wolf",
        x: 380,
        y: (SURFACE - 1) * TS - 36,
        vy: 0,
        dir: -1,
        active: true,
        triggered: false,
        exploded: false,
        flash: false,
        walkDelay: 0,
        startX: 380,
        tamed: false,
        heartTimer: 0,
      },
      {
        kind: "pig",
        x: 900,
        y: (SURFACE - 1) * TS - 34,
        vy: 0,
        dir: 1,
        active: true,
        triggered: false,
        exploded: false,
        flash: false,
        walkDelay: 0,
        startX: 900,
        tamed: false,
        heartTimer: 0,
      },
      {
        kind: "creeper",
        x: 2250,
        y: (SURFACE - 1) * TS - 46,
        vy: 0,
        dir: 1,
        active: true,
        triggered: false,
        exploded: false,
        flash: false,
        walkDelay: 100,
        startX: 2250,
        tamed: false,
        heartTimer: 0,
      },
    ];
    s.storyTriggered = {};
    s.diamondMined = false;
    s.chestOpen = 0;
    s.gameState = "playing";
    s.shakeX = 0;
    s.shakeY = 0;
    s.shakeTimer = 0;
    phraseIdx = 0;
    musicPaused = false;
    endingStarted.current = false;
    s.titlePhase = true;
    s.introDropping = false;
    setTitlePhase(true);
    setAchievement(null);
    setOverlayOn(false);
    setOverlayText("");
    setEndingLines([]);
    setShowReplay(false);
    setHotbarState(Array(9).fill(null));
    setSelSlot(0);
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || started.current) return;
    started.current = true;

    // ── Input ──────────────────────────────────────────────────────────────
    function startGame() {
      const s = sr.current;
      if (!s.titlePhase) return;
      s.titlePhase = false;
      s.py = -7 * TS;
      s.pvy = 0;
      s.pvx = 0;
      s.introDropping = true;
      setTitlePhase(false);
      getAudioCtx();
      startMusic();
    }

    const onKD = (e: KeyboardEvent) => {
      if (
        sr.current.titlePhase &&
        (e.key === "Enter" ||
          e.key === " " ||
          e.key === "ArrowRight" ||
          e.key === "d" ||
          e.key === "D")
      ) {
        startGame();
        return;
      }
      sr.current.keys[e.key] = true;
      if (!audioCtx) {
        getAudioCtx();
        startMusic();
      }
      const n = parseInt(e.key);
      if (n >= 1 && n <= 9) {
        sr.current.selSlot = n - 1;
        setSelSlot(n - 1);
      }
      if (e.key === "q" || e.key === "Q") {
        sr.current.selSlot = (sr.current.selSlot + 8) % 9;
        setSelSlot(sr.current.selSlot);
      }
      if (e.key === "e" || e.key === "E") {
        sr.current.selSlot = (sr.current.selSlot + 1) % 9;
        setSelSlot(sr.current.selSlot);
      }
    };
    const onKU = (e: KeyboardEvent) => {
      sr.current.keys[e.key] = false;
    };

    const getCanvasPos = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width,
        scaleY = canvas.height / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    };

    const onMouseMove = (e: MouseEvent) => {
      const s = sr.current;
      const { x, y } = getCanvasPos(e);
      s.mouseWorldX = x + s.camX;
      s.mouseWorldY = y + s.camY;
    };
    const onMouseDown = (e: MouseEvent) => {
      const s = sr.current;
      if (s.titlePhase) {
        startGame();
        e.preventDefault();
        return;
      }
      if (!audioCtx) {
        getAudioCtx();
        startMusic();
      }
      const { x, y } = getCanvasPos(e);
      s.mouseWorldX = x + s.camX;
      s.mouseWorldY = y + s.camY;
      if (e.button === 0) {
        s.mouseDown = true;
        s.mineActive = true;
        s.mineProgress = 0;
        s.mineTargetX = -1;
        s.mineTargetY = -1;
      }
      if (e.button === 2) {
        s.rightMouseDown = true;
        placeBlock(s);
      }
      e.preventDefault();
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) {
        sr.current.mouseDown = false;
        sr.current.mineActive = false;
        sr.current.mineTargetX = -1;
        sr.current.mineProgress = 0;
      }
      if (e.button === 2) sr.current.rightMouseDown = false;
    };

    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("keydown", onKD);
    window.addEventListener("keyup", onKU);
    window.addEventListener("mouseup", onMouseUp);

    // ── Block placement ────────────────────────────────────────────────────
    function placeBlock(s: typeof sr.current) {
      const slot = s.hotbar[s.selSlot];
      if (!slot) return;
      const info = ITEMS[slot.id];
      if (!info?.placeTile) return;
      const tx = Math.floor(s.mouseWorldX / TS),
        ty = Math.floor(s.mouseWorldY / TS);
      if (tx < 0 || tx >= TILES_W || ty < 0 || ty >= TILES_H) return;
      if (s.world[ty][tx] !== T.AIR) return;
      const px2 = s.px + 14,
        py2 = s.py + 22;
      const dist = Math.hypot(tx * TS + 16 - px2, ty * TS + 16 - py2);
      if (dist > MINE_REACH + 16) return;
      const pTX1 = Math.floor((s.px + 4) / TS),
        pTX2 = Math.floor((s.px + 24) / TS);
      const pTY1 = Math.floor((s.py + 2) / TS),
        pTY2 = Math.floor((s.py + 42) / TS);
      if (tx >= pTX1 && tx <= pTX2 && ty >= pTY1 && ty <= pTY2) return;
      s.world[ty][tx] = info.placeTile;
      slot.count--;
      if (slot.count <= 0) s.hotbar[s.selSlot] = null;
      setHotbarState([...s.hotbar]);
    }

    // ── Mob physics ────────────────────────────────────────────────────────
    function updateMob(mob: Mob) {
      const s = sr.current;
      if (!mob.active || mob.exploded) return;

      mob.vy += GRAVITY;
      mob.y += mob.vy;

      const mobH = mob.kind === "wolf" ? 36 : mob.kind === "pig" ? 34 : 46;
      const footTX = Math.floor((mob.x + 16) / TS),
        footTY = Math.floor((mob.y + mobH) / TS);
      if (isSolid(s.world, footTX, footTY) && mob.vy >= 0) {
        mob.y = footTY * TS - mobH;
        mob.vy = 0;
      }

      if (mob.walkDelay > 0) {
        mob.walkDelay--;
        return;
      }

      if (mob.heartTimer > 0) {
        mob.heartTimer--;
        if (mob.heartTimer % 18 === 0) spawnHearts(mob.x + 16, mob.y - 10, 6);
      }

      if (mob.kind === "creeper" && mob.triggered) {
        const dx = s.px - mob.x;
        mob.x += Math.sign(dx) * 1.4;
        mob.flash = Math.abs(dx) < 80 && Math.floor(Date.now() / 100) % 2 === 0;
        if (Math.abs(dx) < 32 && !mob.exploded) {
          mob.exploded = true;
          mob.active = false;
          spawnConfetti(mob.x + 14, mob.y + 20, 120);
          triggerShake(6, 25);
          playCreeperPop();
          showDialogue(DLGS.creeper, 6000);
          setTimeout(() => {
            resumeMusic();
            s.gameState = "playing";
          }, 4500);
        }
      } else if (mob.tamed) {
        const dx = s.px - mob.x;
        const absDx = Math.abs(dx);
        if (absDx > 90) {
          mob.x += Math.sign(dx) * 1.6;
          mob.dir = Math.sign(dx) as 1 | -1;
        } else if (absDx > 40) {
          mob.x += Math.sign(dx) * 0.8;
          mob.dir = Math.sign(dx) as 1 | -1;
        }
        mob.x = Math.max(0, Math.min(WORLD_W - 40, mob.x));
      } else if (mob.kind !== "creeper") {
        mob.x += mob.dir * 1.2;
        if (Math.abs(mob.x - mob.startX) > 120)
          mob.dir = (mob.dir * -1) as 1 | -1;
      }

      mob.x = Math.max(0, Math.min(WORLD_W - 40, mob.x));
    }

    // ── Tile collision for player ─────────────────────────────────────────
    function resolveTiles() {
      const s = sr.current;
      const w = s.world,
        pw = 26,
        ph = 44;

      s.px = Math.max(0, Math.min(WORLD_W - pw, s.px));

      if (s.pvx > 0) {
        const tx = Math.floor((s.px + pw) / TS);
        const ty1 = Math.floor((s.py + 4) / TS),
          ty2 = Math.floor((s.py + ph - 6) / TS);
        if (isSolid(w, tx, ty1) || isSolid(w, tx, ty2)) {
          s.px = tx * TS - pw;
          s.pvx = 0;
        }
      }
      if (s.pvx < 0) {
        const tx = Math.floor((s.px - 1) / TS);
        const ty1 = Math.floor((s.py + 4) / TS),
          ty2 = Math.floor((s.py + ph - 6) / TS);
        if (isSolid(w, tx, ty1) || isSolid(w, tx, ty2)) {
          s.px = (tx + 1) * TS;
          s.pvx = 0;
        }
      }

      s.onGround = false;
      if (s.pvy >= 0) {
        const ty = Math.floor((s.py + ph) / TS);
        const tx1 = Math.floor((s.px + 3) / TS),
          tx2 = Math.floor((s.px + pw - 3) / TS);
        if (isSolid(w, tx1, ty) || isSolid(w, tx2, ty)) {
          s.py = ty * TS - ph;
          s.pvy = 0;
          s.onGround = true;
        }
      }
      if (s.pvy < 0) {
        const ty = Math.floor(s.py / TS);
        const tx1 = Math.floor((s.px + 3) / TS),
          tx2 = Math.floor((s.px + pw - 3) / TS);
        if (isSolid(w, tx1, ty) || isSolid(w, tx2, ty)) {
          s.py = (ty + 1) * TS;
          s.pvy = 0;
        }
      }
      if (s.py + ph > WORLD_H) {
        s.py = WORLD_H - ph;
        s.pvy = 0;
        s.onGround = true;
      }
      if (s.py < 0) {
        s.py = 0;
        s.pvy = 0;
      }
    }

    // ── Update ────────────────────────────────────────────────────────────
    function update() {
      const s = sr.current;

      if (s.titlePhase) return;
      if (s.gameState === "ending") return;

      if (s.shakeTimer > 0) {
        s.shakeTimer--;
        s.shakeX = (Math.random() - 0.5) * 8;
        s.shakeY = (Math.random() - 0.5) * 8;
        if (!s.shakeTimer) {
          s.shakeX = 0;
          s.shakeY = 0;
        }
      }

      const canMove =
        s.gameState === "playing" ||
        (s.gameState === "creeper_chase" && sr.current.mobs[2].exploded);
      if (canMove) {
        const left = s.keys["ArrowLeft"] || s.keys["a"] || s.keys["A"];
        const right = s.keys["ArrowRight"] || s.keys["d"] || s.keys["D"];
        const jump =
          s.keys["ArrowUp"] || s.keys[" "] || s.keys["w"] || s.keys["W"];
        if (right) {
          s.pvx += MOVE_SPEED * 0.45;
          s.facingRight = true;
        }
        if (left) {
          s.pvx -= MOVE_SPEED * 0.45;
          s.facingRight = false;
        }
        s.pvx *= FRICTION;
        s.pvx = Math.max(-MOVE_SPEED, Math.min(MOVE_SPEED, s.pvx));
        if (jump && s.onGround) {
          s.pvy = JUMP_FORCE;
          s.onGround = false;
          playJump();
        }
      }

      s.pvy += GRAVITY;
      s.px += s.pvx;
      s.py += s.pvy;
      resolveTiles();

      if (s.introDropping && s.onGround) {
        s.introDropping = false;
        s.shakeTimer = 18;
        s.shakeX = 3;
        s.shakeY = 3;
        spawnHearts(s.px + 14, s.py);
      }

      const tgX = s.px - CW / 2 + 14;
      const tgY = s.py - CH / 2 + 22;
      s.camX += (tgX - s.camX) * CAM_LERP;
      s.camY += (tgY - s.camY) * CAM_LERP;
      s.camX = Math.max(0, Math.min(WORLD_W - CW, s.camX));
      s.camY = Math.max(0, Math.min(WORLD_H - CH, s.camY));

      if (s.mineActive && s.gameState === "playing") {
        const tx = Math.floor(s.mouseWorldX / TS),
          ty = Math.floor(s.mouseWorldY / TS);
        if (tx < 0 || tx >= TILES_W || ty < 0 || ty >= TILES_H) {
          s.mineTargetX = -1;
          s.mineProgress = 0;
        } else {
          const tid = s.world[ty][tx];
          if (tid === T.AIR) {
            s.mineTargetX = -1;
            s.mineProgress = 0;
          } else {
            const cx = s.px + 14,
              cy = s.py + 22;
            const dist = Math.hypot(tx * TS + 16 - cx, ty * TS + 16 - cy);
            if (dist > MINE_REACH) {
              s.mineTargetX = -1;
              s.mineProgress = 0;
            } else {
              if (s.mineTargetX !== tx || s.mineTargetY !== ty) {
                s.mineTargetX = tx;
                s.mineTargetY = ty;
                s.mineProgress = 0;
              }
              const mf = MINE_FRAMES[tid] ?? 60;
              if (mf < Infinity) {
                s.mineProgress++;
                s.mineHitTimer++;
                if (s.mineHitTimer % 12 === 0) playMineHit();
                if (s.mineProgress >= mf) {
                  s.world[ty][tx] = T.AIR;
                  s.mineTargetX = -1;
                  s.mineProgress = 0;
                  playBlockBreak();
                  const drop = TILE_DROP[tid];
                  if (drop) {
                    s.drops.push({
                      id: drop,
                      x: tx * TS + 8,
                      y: ty * TS + 8,
                      vy: -2,
                      bob: 0,
                      dead: false,
                    });
                    if (drop === "diamond" && !s.storyTriggered["diamond"]) {
                      s.storyTriggered["diamond"] = true;
                      s.diamondMined = true;
                      playDiamondCue();
                      spawnConfetti(tx * TS + 16, ty * TS + 16, 40);
                      showAchievement(
                        "💎",
                        "Diamond Mined!",
                        "Rare and precious, just like you.",
                      );
                      showDialogue(DLGS.diamond, 5000);
                    }
                  }
                }
              }
            }
          }
        }
      }

      if (s.mobileMining && s.gameState === "playing") {
        const cx = s.px + (s.facingRight ? 40 : -8);
        const cy = s.py + 24;
        const tx = Math.floor(cx / TS),
          ty = Math.floor(cy / TS);
        if (
          tx >= 0 &&
          tx < TILES_W &&
          ty >= 0 &&
          ty < TILES_H &&
          s.world[ty][tx] !== T.AIR &&
          s.world[ty][tx] !== T.BEDROCK
        ) {
          if (s.mineTargetX !== tx || s.mineTargetY !== ty) {
            s.mineTargetX = tx;
            s.mineTargetY = ty;
            s.mineProgress = 0;
          }
          const mf = MINE_FRAMES[s.world[ty][tx]] ?? 60;
          s.mineProgress++;
          s.mineHitTimer++;
          if (s.mineHitTimer % 12 === 0) playMineHit();
          if (s.mineProgress >= mf) {
            const drop = TILE_DROP[s.world[ty][tx]];
            s.world[ty][tx] = T.AIR;
            s.mineTargetX = -1;
            s.mineProgress = 0;
            playBlockBreak();
            if (drop) {
              s.drops.push({
                id: drop,
                x: tx * TS + 8,
                y: ty * TS + 8,
                vy: -2,
                bob: 0,
                dead: false,
              });
              if (drop === "diamond" && !s.storyTriggered["diamond"]) {
                s.storyTriggered["diamond"] = true;
                s.diamondMined = true;
                playDiamondCue();
                spawnConfetti(tx * TS + 16, ty * TS + 16, 40);
                showAchievement(
                  "💎",
                  "Diamond Mined!",
                  "Rare and precious, just like you.",
                );
                showDialogue(DLGS.diamond, 5000);
              }
            }
          }
        }
      }

      if (s.mobilePlace && s.gameState === "playing") {
        const tx = Math.floor((s.px + (s.facingRight ? 44 : -12)) / TS);
        const ty = Math.floor((s.py + 22) / TS);
        if (
          tx >= 0 &&
          tx < TILES_W &&
          ty >= 0 &&
          ty < TILES_H &&
          s.world[ty][tx] === T.AIR
        ) {
          const slot = s.hotbar[s.selSlot];
          if (slot) {
            const info = ITEMS[slot.id];
            if (info?.placeTile) {
              s.world[ty][tx] = info.placeTile;
              slot.count--;
              if (slot.count <= 0) s.hotbar[s.selSlot] = null;
              setHotbarState([...s.hotbar]);
            }
          }
        }
        s.mobilePlace = false;
      }

      for (const drop of s.drops) {
        if (drop.dead) continue;
        drop.vy += 0.3;
        drop.y += drop.vy;
        drop.bob += 0.05;
        const dty = Math.floor((drop.y + 12) / TS),
          dtx = Math.floor((drop.x + 6) / TS);
        if (isSolid(s.world, dtx, dty) && drop.vy > 0) {
          drop.y = dty * TS - 12;
          drop.vy *= -0.3;
          if (Math.abs(drop.vy) < 0.5) drop.vy = 0;
        }
        const dx = s.px + 14 - drop.x,
          dy = s.py + 22 - drop.y;
        const d = Math.hypot(dx, dy);
        if (d < 60) {
          drop.x += dx * 0.15;
          drop.y += dy * 0.15;
          if (d < 16) {
            drop.dead = true;
            addToInventory(drop.id);
            playCollectItem();
          }
        }
      }
      s.drops = s.drops.filter((d) => !d.dead);

      s.particles = s.particles.filter((p) => p.life > 0);
      for (const p of s.particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.18;
        p.vx *= 0.97;
        p.life -= 0.013;
      }

      for (const mob of s.mobs) updateMob(mob);

      const wolf = s.mobs[0],
        pig = s.mobs[1],
        creeper = s.mobs[2];
      if (wolf.active && !wolf.triggered && Math.abs(s.px - wolf.x) < 90) {
        wolf.triggered = true;
        playWolfCue();
        showDialogue(DLGS.wolf, 7000);
        setTimeout(() => {
          wolf.tamed = true;
          wolf.heartTimer = 90;
          spawnHearts(wolf.x + 16, wolf.y, 20);
          showAchievement(
            "🐺",
            "Wolf Tamed!",
            "Your loyal companion will follow you.",
          );
        }, 4600);
      }
      if (pig.active && !pig.triggered && Math.abs(s.px - pig.x) < 90) {
        pig.triggered = true;
        playPigCue();
        showDialogue(DLGS.pig, 6000);
        setTimeout(() => {
          pig.tamed = true;
          pig.heartTimer = 60;
          spawnHearts(pig.x + 16, pig.y, 16);
          s.drops.push({
            id: "apple",
            x: pig.x + 16,
            y: pig.y - 10,
            vy: -3,
            bob: 0,
            dead: false,
          });
          showAchievement(
            "🐷",
            "Pig Befriended!",
            "A gift for you — freshly dropped apple!",
          );
        }, 4100);
      }

      if (
        !s.storyTriggered["diamond"] &&
        !s.storyTriggered["shaft_hint"] &&
        Math.abs(s.px - STORY_DIA_COL * TS) < 130
      ) {
        s.storyTriggered["shaft_hint"] = true;
        showDialogue(
          "✨ Something sparkles deep below…\nLook for the open shaft between the iron pillars\nand go mining!",
          6000,
        );
      }

      if (
        creeper.active &&
        !creeper.triggered &&
        s.diamondMined &&
        Math.abs(s.px - creeper.x) < 200
      ) {
        creeper.triggered = true;
        s.gameState = "creeper_chase";
        pauseMusic();
        playCreeperHiss();
      }
      if (
        !s.diamondMined &&
        !s.storyTriggered["creeper_nudge"] &&
        s.px > creeper.x - 400
      ) {
        s.storyTriggered["creeper_nudge"] = true;
        showDialogue(
          "💎 You sense danger ahead…\nMaybe find that diamond first!",
          4500,
        );
      }

      if (s.gameState === "playing" && !s.storyTriggered["chest"]) {
        if (
          Math.abs(s.px - CHEST_X) < 80 &&
          Math.abs(s.py + 22 - CHEST_Y - 20) < 80
        ) {
          s.storyTriggered["chest"] = true;
          s.gameState = "chest_open";
          playChestOpen();
          spawnConfetti(CHEST_X + 20, CHEST_Y - 20, 120);
        }
      }
      if (s.gameState === "chest_open") {
        s.chestOpen = Math.min(1, s.chestOpen + 0.012);
        if (s.chestOpen >= 1) {
          s.gameState = "ending";
          startEnding();
        }
      }

      for (const c of s.clouds) {
        c.x += c.spd;
        if (c.x > WORLD_W) c.x = -110;
      }
    }

    // ── Render ─────────────────────────────────────────────────────────────
    function render() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const s = sr.current;

      if (s.titlePhase) {
        renderTitle(ctx);
        return;
      }

      ctx.save();
      if (s.shakeTimer > 0) ctx.translate(s.shakeX, s.shakeY);

      const surfaceScreenY = SURFACE * TS - s.camY;
      if (surfaceScreenY > CH) {
        ctx.fillStyle = "#1a1a2e";
        ctx.fillRect(0, 0, CW, CH);
        const dg = ctx.createLinearGradient(0, 0, 0, CH);
        dg.addColorStop(0, "rgba(0,0,40,0)");
        dg.addColorStop(1, "rgba(0,0,0,0.4)");
        ctx.fillStyle = dg;
        ctx.fillRect(0, 0, CW, CH);
      } else if (surfaceScreenY < 0) {
        const sg = ctx.createLinearGradient(0, 0, 0, CH);
        sg.addColorStop(0, "#87CEEB");
        sg.addColorStop(1, "#C9E8F5");
        ctx.fillStyle = sg;
        ctx.fillRect(0, 0, CW, CH);
      } else {
        const sg = ctx.createLinearGradient(0, 0, 0, CH);
        sg.addColorStop(0, "#87CEEB");
        sg.addColorStop(Math.max(0, (surfaceScreenY - TS) / CH), "#C9E8F5");
        sg.addColorStop(Math.min(1, (surfaceScreenY + TS) / CH), "#1a1a2e");
        sg.addColorStop(1, "#0d0d1a");
        ctx.fillStyle = sg;
        ctx.fillRect(0, 0, CW, CH);
      }

      if (surfaceScreenY > -80) {
        for (const c of s.clouds) {
          const cx = c.x - s.camX * 0.3,
            cy = c.y - s.camY;
          if (cy > -70 && cy < surfaceScreenY + 30) drawCloud(ctx, cx, cy);
        }
      }

      ctx.save();
      ctx.translate(-Math.round(s.camX), -Math.round(s.camY));

      const tx0 = Math.max(0, Math.floor(s.camX / TS) - 1);
      const tx1 = Math.min(TILES_W, Math.ceil((s.camX + CW) / TS) + 1);
      const ty0 = Math.max(0, Math.floor(s.camY / TS) - 1);
      const ty1 = Math.min(TILES_H, Math.ceil((s.camY + CH) / TS) + 1);
      for (let ty = ty0; ty < ty1; ty++) {
        for (let tx = tx0; tx < tx1; tx++) {
          const id = s.world[ty][tx];
          if (id !== T.AIR) drawTile(ctx, id, tx * TS, ty * TS);
        }
      }

      if (s.mineTargetX >= 0) {
        const mx = s.mineTargetX * TS,
          my = s.mineTargetY * TS;
        const tid = s.world[s.mineTargetY]?.[s.mineTargetX] ?? 0;
        const mf = MINE_FRAMES[tid] ?? 60;
        const prog = mf < Infinity ? s.mineProgress / mf : 0;
        ctx.fillStyle = `rgba(0,0,0,${prog * 0.55})`;
        ctx.fillRect(mx, my, TS, TS);
        ctx.strokeStyle = "rgba(0,0,0,0.7)";
        ctx.lineWidth = 1.5;
        const cracks = Math.floor(prog * 5);
        for (let i = 0; i < cracks; i++) {
          const ang = i * (Math.PI / 2.5) + prog;
          ctx.beginPath();
          ctx.moveTo(mx + 16, my + 16);
          ctx.lineTo(
            mx + 16 + Math.cos(ang) * 12,
            my + 16 + Math.sin(ang) * 12,
          );
          ctx.stroke();
        }
        ctx.fillStyle = "#FFD700";
        ctx.fillRect(mx, my + TS - 5, TS * prog, 5);
        ctx.strokeStyle = "#333";
        ctx.lineWidth = 1;
        ctx.strokeRect(mx, my + TS - 5, TS, 5);
      }

      for (const drop of s.drops) {
        const bob = Math.sin(drop.bob) * 3;
        const info = ITEMS[drop.id];
        if (!info) continue;
        const dx = Math.round(drop.x),
          dy = Math.round(drop.y + bob);
        ctx.fillStyle = "rgba(0,0,0,0.2)";
        ctx.beginPath();
        ctx.ellipse(dx + 8, drop.y + 16, 6, 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = info.col;
        ctx.fillRect(dx, dy, 14, 14);
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.fillRect(dx + 2, dy + 2, 5, 5);
        if (drop.id === "diamond") {
          ctx.strokeStyle = "#00FFFF";
          ctx.lineWidth = 1;
          ctx.strokeRect(dx, dy, 14, 14);
        }
      }

      for (const mob of s.mobs) {
        if (!mob.active) continue;
        if (mob.kind === "wolf") drawWolf(ctx, mob.x, mob.y);
        if (mob.kind === "pig") drawPig(ctx, mob.x, mob.y);
        if (mob.kind === "creeper") drawCreeper(ctx, mob.x, mob.y, mob.flash);

        if (mob.tamed) {
          const mx = Math.round(mob.x),
            my = Math.round(mob.y);
          ctx.fillStyle = "#CC1111";
          ctx.fillRect(mx + 6, my + 18, 16, 4);
          ctx.fillStyle = "#FF3333";
          ctx.fillRect(mx + 7, my + 18, 2, 4);
          const labelY = my - 8 + Math.round(Math.sin(Date.now() / 600) * 3);
          ctx.save();
          ctx.fillStyle = "rgba(0,0,0,0.55)";
          ctx.beginPath();
          ctx.roundRect(mx - 2, labelY - 12, 36, 14, 4);
          ctx.fill();
          ctx.fillStyle = "#FF69B4";
          ctx.font = "bold 10px monospace";
          ctx.textAlign = "center";
          ctx.fillText("♥ Pet", mx + 14, labelY);
          ctx.restore();
        }
      }

      drawChest(ctx, CHEST_X, CHEST_Y, s.chestOpen);

      if (s.gameState !== "ending") {
        const held = s.hotbar[s.selSlot]?.id;
        drawPlayer(ctx, s.px, s.py, s.facingRight, held);
      }

      if (s.gameState === "playing") {
        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,0.12)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(s.px + 14, s.py + 22, MINE_REACH, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      for (const p of s.particles) {
        ctx.save();
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.col;
        ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
        ctx.restore();
      }

      ctx.restore();

      const playerRow = Math.floor((s.py + 44) / TS);
      const depthBelowSurface = playerRow - SURFACE;
      if (depthBelowSurface > 0) {
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(CW - 110, 8, 102, 20);
        ctx.fillStyle = "#aaa";
        ctx.font = "11px monospace";
        ctx.textAlign = "right";
        ctx.fillText(`Depth: ${depthBelowSurface} blocks`, CW - 10, 23);
      }

      const prog = Math.min(1, s.px / WORLD_W);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(10, 10, 200, 10);
      ctx.fillStyle = "#FFD700";
      ctx.fillRect(10, 10, 200 * prog, 10);
      ctx.strokeStyle = "#555";
      ctx.lineWidth = 1;
      ctx.strokeRect(10, 10, 200, 10);
      ctx.fillStyle = "#fff";
      ctx.font = "10px monospace";
      ctx.textAlign = "left";
      ctx.fillText("Journey", 12, 36);

      const slotS = 40,
        gap = 2;
      const hbW = 9 * (slotS + gap) - gap;
      const hbX = (CW - hbW) / 2,
        hbY = CH - slotS - 8;
      for (let i = 0; i < 9; i++) {
        const sx = hbX + i * (slotS + gap);
        const sel = i === s.selSlot;
        ctx.fillStyle = sel ? "rgba(255,255,200,0.85)" : "rgba(40,40,40,0.75)";
        ctx.fillRect(sx, hbY, slotS, slotS);
        ctx.strokeStyle = sel ? "#FFD700" : "rgba(200,200,200,0.5)";
        ctx.lineWidth = sel ? 2.5 : 1.5;
        ctx.strokeRect(sx, hbY, slotS, slotS);
        const slot = s.hotbar[i];
        if (slot && ITEMS[slot.id]) {
          const info = ITEMS[slot.id];
          ctx.fillStyle = info.col;
          ctx.fillRect(sx + 8, hbY + 8, slotS - 16, slotS - 16);
          ctx.fillStyle = "rgba(255,255,255,0.3)";
          ctx.fillRect(sx + 10, hbY + 10, 8, 6);
          if (slot.id === "diamond") {
            ctx.strokeStyle = "#00FFFF";
            ctx.lineWidth = 1;
            ctx.strokeRect(sx + 8, hbY + 8, slotS - 16, slotS - 16);
          }
          if (slot.count > 1) {
            ctx.fillStyle = "#fff";
            ctx.font = "bold 10px monospace";
            ctx.textAlign = "right";
            ctx.fillText(String(slot.count), sx + slotS - 3, hbY + slotS - 3);
          }
        }
        ctx.fillStyle = "rgba(200,200,200,0.7)";
        ctx.font = "8px monospace";
        ctx.textAlign = "left";
        ctx.fillText(String(i + 1), sx + 3, hbY + 10);
      }

      const curSlot = s.hotbar[s.selSlot];
      if (curSlot) {
        const label = ITEMS[curSlot.id]?.label || curSlot.id;
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(CW / 2 - 50, hbY - 22, 100, 18);
        ctx.fillStyle = "#fff";
        ctx.font = "11px monospace";
        ctx.textAlign = "center";
        ctx.fillText(label, CW / 2, hbY - 8);
      }

      if (s.px < 200 && s.gameState === "playing") {
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(CW / 2 - 160, CH - 92, 320, 28);
        ctx.fillStyle = "#fff";
        ctx.font = "11px monospace";
        ctx.textAlign = "center";
        ctx.fillText(
          "← → / WASD: move  |  Space/↑: jump  |  Click to mine  |  Right-click to place",
          CW / 2,
          CH - 73,
        );
      }

      ctx.restore();
    }

    // ── Game loop ─────────────────────────────────────────────────────────
    let last = 0;
    function loop(t: number) {
      if (t - last < 100) {
        update();
        render();
      } else render();
      last = t;
      animRef.current = requestAnimationFrame(loop);
    }
    animRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animRef.current);
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("keydown", onKD);
      window.removeEventListener("keyup", onKU);
      window.removeEventListener("mouseup", onMouseUp);
      if (musicTimer) clearTimeout(musicTimer);
    };
  }, []);

  const touch = (key: string, down: boolean) => {
    sr.current.keys[key] = down;
    if (!audioCtx) {
      getAudioCtx();
      startMusic();
    }
  };

  // suppress the unused variable warning — selSlot is used by hotbarState renders
  void selSlot;

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: "#000",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        fontFamily: "monospace",
      }}
    >
      <div style={{ position: "relative" }}>
        <canvas
          ref={canvasRef}
          width={CW}
          height={CH}
          style={{
            imageRendering: "pixelated",
            display: "block",
            border: "3px solid #333",
          }}
          tabIndex={0}
          onClick={() => {
            canvasRef.current?.focus();
            if (!audioCtx) {
              getAudioCtx();
              startMusic();
            }
          }}
        />

        {achievement && (
          <div
            style={{
              position: "absolute",
              top: 12,
              left: "50%",
              transform: "translateX(-50%)",
              background: "rgba(0,0,0,0.82)",
              border: "2px solid #FFD700",
              borderRadius: 8,
              padding: "10px 18px",
              color: "#fff",
              fontSize: 13,
              display: "flex",
              alignItems: "center",
              gap: 12,
              zIndex: 30,
              pointerEvents: "none",
              animation: "toastIn 0.3s ease",
              minWidth: 220,
            }}
          >
            <span style={{ fontSize: 28 }}>{achievement.icon}</span>
            <div>
              <div
                style={{
                  color: "#FFD700",
                  fontWeight: "bold",
                  fontSize: 11,
                  letterSpacing: 2,
                  marginBottom: 2,
                }}
              >
                ACHIEVEMENT UNLOCKED
              </div>
              <div style={{ fontWeight: "bold" }}>{achievement.title}</div>
              <div style={{ color: "#aaa", fontSize: 11, marginTop: 2 }}>
                {achievement.sub}
              </div>
            </div>
          </div>
        )}

        {overlayOn && (
          <div
            style={{
              position: "absolute",
              bottom: 100,
              left: "50%",
              transform: "translateX(-50%)",
              background: "rgba(0,0,0,0.85)",
              border: "2px solid #FFD700",
              borderRadius: 8,
              padding: "12px 20px",
              color: "#fff",
              fontSize: 14,
              whiteSpace: "pre-line",
              textAlign: "center",
              maxWidth: 460,
              lineHeight: 1.7,
              zIndex: 10,
              pointerEvents: "none",
            }}
          >
            {overlayText}
          </div>
        )}

        {endingLines.length > 0 && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(0,0,0,0.90)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 20,
              padding: "32px 48px",
            }}
          >
            <div
              style={{
                color: "#FFD700",
                fontSize: 14,
                whiteSpace: "pre-line",
                textAlign: "center",
                lineHeight: 2.1,
                maxWidth: 500,
              }}
            >
              {endingLines.map((line, i) => (
                <div key={i} style={{ animation: "fadeIn 0.9s ease" }}>
                  {line || "\u00A0"}
                </div>
              ))}
            </div>
            {showReplay && (
              <button
                onClick={resetGame}
                style={{
                  marginTop: 32,
                  padding: "10px 28px",
                  background: "#FFD700",
                  color: "#000",
                  border: "none",
                  borderRadius: 6,
                  fontSize: 14,
                  fontWeight: "bold",
                  cursor: "pointer",
                  fontFamily: "monospace",
                }}
              >
                Play Again
              </button>
            )}
          </div>
        )}
      </div>

      <div
        style={{
          display: titlePhase ? "none" : "flex",
          gap: 8,
          marginTop: 10,
          userSelect: "none",
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        <button
          onPointerDown={() => touch("ArrowLeft", true)}
          onPointerUp={() => touch("ArrowLeft", false)}
          onPointerLeave={() => touch("ArrowLeft", false)}
          style={btn}
        >
          ◀
        </button>
        <button
          onPointerDown={() => touch(" ", true)}
          onPointerUp={() => touch(" ", false)}
          onPointerLeave={() => touch(" ", false)}
          style={{
            ...btn,
            background: "#FFD700",
            color: "#000",
            fontWeight: "bold",
          }}
        >
          JUMP
        </button>
        <button
          onPointerDown={() => touch("ArrowRight", true)}
          onPointerUp={() => touch("ArrowRight", false)}
          onPointerLeave={() => touch("ArrowRight", false)}
          style={btn}
        >
          ▶
        </button>
        <button
          onPointerDown={() => {
            sr.current.mobileMining = true;
            if (!audioCtx) {
              getAudioCtx();
              startMusic();
            }
          }}
          onPointerUp={() => {
            sr.current.mobileMining = false;
            sr.current.mineTargetX = -1;
            sr.current.mineProgress = 0;
          }}
          onPointerLeave={() => {
            sr.current.mobileMining = false;
            sr.current.mineTargetX = -1;
            sr.current.mineProgress = 0;
          }}
          style={{ ...btn, background: "#8B4513", fontSize: 18 }}
        >
          ⛏
        </button>
        <button
          onPointerDown={() => {
            sr.current.mobilePlace = true;
            if (!audioCtx) {
              getAudioCtx();
              startMusic();
            }
          }}
          onPointerUp={() => {
            sr.current.mobilePlace = false;
          }}
          style={{ ...btn, background: "#5A9E44", fontSize: 18 }}
        >
          🧱
        </button>
        <button
          onPointerDown={() => {
            sr.current.selSlot = (sr.current.selSlot + 8) % 9;
            setSelSlot(sr.current.selSlot);
          }}
          style={{ ...btn, fontSize: 12 }}
        >
          ◁ slot
        </button>
        <button
          onPointerDown={() => {
            sr.current.selSlot = (sr.current.selSlot + 1) % 9;
            setSelSlot(sr.current.selSlot);
          }}
          style={{ ...btn, fontSize: 12 }}
        >
          slot ▷
        </button>
      </div>
      <style>{`
        @keyframes fadeIn{ from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
        @keyframes toastIn{ from{opacity:0;transform:translateX(-50%) translateY(-14px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }
      `}</style>
    </div>
  );
}

const btn: React.CSSProperties = {
  width: 58,
  height: 46,
  background: "rgba(255,255,255,0.15)",
  color: "#fff",
  border: "2px solid rgba(255,255,255,0.3)",
  borderRadius: 8,
  fontSize: 18,
  cursor: "pointer",
  fontFamily: "monospace",
  touchAction: "none",
};
