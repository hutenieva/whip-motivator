let whipEnabled = false;
let canvas = null;
let ctx = null;
let mouseX = 0;
let mouseY = 0;
let animationId = null;
let currentMode = 'neutral'; // neutral, loving, angry, mixed
let soundEnabled = true;

// --- Emoji sets ---
const EMOJIS_LOVING = ['❤️', '🥰', '💋', '🧚', '✨', '💖'];
const EMOJIS_ANGRY = ['😠', '🤯', '🤬', '😡', '🤥', '😟', '🤡'];
const EMOJIS_MIXED = [...EMOJIS_LOVING, ...EMOJIS_ANGRY];

// Active emoji particles
let emojiParticles = [];

// --- Colors ---
const COLOR_HANDLE = '#221409';
const COLOR_HANDLE_GRIP = '#3D2816';
const COLOR_WHIP = '#EB94F5';
const COLOR_WHIP_HIGHLIGHT = '#F0B0FA';
const COLOR_WHIP_SHADOW = '#C060D0';

// --- Handle config ---
const HANDLE_OFFSET_X = 32;
const HANDLE_OFFSET_Y = 0;
const HANDLE_SEGS = 6;
const HANDLE_SEG_LEN = 12;
// Resting angle: handle points UP and slightly left (-30° from vertical-up)
const HANDLE_REST_ANGLE = (-30 * Math.PI) / 180;

// --- Whip config ---
const WHIP_SEGS = 22;
const TOTAL_SEGS = HANDLE_SEGS + WHIP_SEGS;
const WHIP_SEG_LEN = 11;
const GRAVITY = 0.35;
const DAMPING = 0.965;

// --- Animated handle state ---
let handleAnimOffsetX = 0;   // current animated offset from resting pos
let handleAnimOffsetY = 0;
let handleAnimAngle = 0;     // current animated angle offset from rest
// Targets for smooth interpolation
let handleTargetOffsetX = 0;
let handleTargetOffsetY = 0;
let handleTargetAngle = 0;
const HANDLE_LERP = 0.3;     // smoothing speed (snappy)

// --- Strike state ---
let isStriking = false;
let strikePhase = 0;
let strikeTimer = 0;
let strikeTargetX = 0;
let strikeTargetY = 0;
let sparkTimer = 0;

// --- Points ---
let points = [];

// Current handle angle = rest + animation offset
function getCurrentAngle() {
  return HANDLE_REST_ANGLE + handleAnimAngle;
}

// Handle direction (points UPWARD from anchor)
function getHandleDirX() { return Math.sin(getCurrentAngle()); }
function getHandleDirY() { return -Math.cos(getCurrentAngle()); } // negative = up

// Anchor = cursor + offset + animated offset
function getAnchorX() { return mouseX + HANDLE_OFFSET_X + handleAnimOffsetX; }
function getAnchorY() { return mouseY + HANDLE_OFFSET_Y + handleAnimOffsetY; }

// Handle segment i position (knob at bottom = seg 0, whip attaches at top = last seg)
// seg 0 is the grip (near cursor), segments go upward
function getHandlePos(i) {
  return {
    x: getAnchorX() + i * HANDLE_SEG_LEN * getHandleDirX(),
    y: getAnchorY() + i * HANDLE_SEG_LEN * getHandleDirY(),
  };
}

function getWhipAttachPos() {
  return getHandlePos(HANDLE_SEGS - 1);
}

function initRope() {
  points = [];
  const attach = getWhipAttachPos();
  for (let i = 0; i < TOTAL_SEGS; i++) {
    if (i < HANDLE_SEGS) {
      const hp = getHandlePos(i);
      points.push({ x: hp.x, y: hp.y, ox: hp.x, oy: hp.y });
    } else {
      const wi = i - HANDLE_SEGS;
      // Init whip hanging down from attach point
      const x = attach.x;
      const y = attach.y + wi * WHIP_SEG_LEN;
      points.push({ x, y, ox: x, oy: y });
    }
  }
}

// --- Smooth handle animation ---

function updateHandleAnimation() {
  handleAnimOffsetX += (handleTargetOffsetX - handleAnimOffsetX) * HANDLE_LERP;
  handleAnimOffsetY += (handleTargetOffsetY - handleAnimOffsetY) * HANDLE_LERP;
  handleAnimAngle += (handleTargetAngle - handleAnimAngle) * HANDLE_LERP;
}

// --- Physics ---

function updatePhysics() {
  // Animate handle position/angle smoothly
  updateHandleAnimation();

  // Force handle segments to rigid positions
  for (let i = 0; i < HANDLE_SEGS; i++) {
    const hp = getHandlePos(i);
    points[i].x = hp.x;
    points[i].y = hp.y;
    points[i].ox = hp.x;
    points[i].oy = hp.y;
  }

  // Whip segments: smooth exponential flexibility gradient
  for (let i = HANDLE_SEGS; i < TOTAL_SEGS; i++) {
    const t = (i - HANDLE_SEGS) / (TOTAL_SEGS - HANDLE_SEGS - 1); // 0 at handle, 1 at tip
    // Exponential falloff: stiff at handle, smooth transition to loose
    const stiffFactor = Math.exp(-t * 4); // 1.0 at handle → ~0.02 at tip
    // Damping: 0.80 (stiff) near handle → 0.97 (loose) at tip
    const segDamping = 0.97 - stiffFactor * 0.17;
    // Gravity: smooth ramp — very weak near handle, full at tip
    const segGravity = GRAVITY * (1 - stiffFactor * 0.9);

    const p = points[i];
    const vx = (p.x - p.ox) * segDamping;
    const vy = (p.y - p.oy) * segDamping;
    p.ox = p.x;
    p.oy = p.y;
    p.x += vx;
    p.y += vy + segGravity;
  }

  // Chain stiffness: each segment resists bending from its predecessor (smooth falloff)
  for (let i = HANDLE_SEGS; i < TOTAL_SEGS; i++) {
    const t = (i - HANDLE_SEGS) / (TOTAL_SEGS - HANDLE_SEGS - 1);
    const stiffness = 0.12 * Math.exp(-t * 5); // smooth exponential decay across whole whip
    if (stiffness < 0.001) break;

    const prev = points[i - 1];
    const prevPrev = i >= 2 ? points[i - 2] : prev;
    // Direction from prev-prev to prev (local chain direction)
    const cdx = prev.x - prevPrev.x;
    const cdy = prev.y - prevPrev.y;
    const clen = Math.sqrt(cdx * cdx + cdy * cdy);
    if (clen === 0) continue;
    // Ideal position: continue in the same direction
    const idealX = prev.x + (cdx / clen) * WHIP_SEG_LEN;
    const idealY = prev.y + (cdy / clen) * WHIP_SEG_LEN;
    points[i].x += (idealX - points[i].x) * stiffness;
    points[i].y += (idealY - points[i].y) * stiffness;
  }

  // Strike forces on whip
  if (isStriking) {
    applyStrikeForces();
  }

  // Distance constraints
  for (let iter = 0; iter < 6; iter++) {
    for (let i = 0; i < HANDLE_SEGS; i++) {
      const hp = getHandlePos(i);
      points[i].x = hp.x;
      points[i].y = hp.y;
    }

    for (let i = 0; i < TOTAL_SEGS - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const targetLen = i < HANDLE_SEGS ? HANDLE_SEG_LEN : WHIP_SEG_LEN;
      if (dist === 0) continue;
      const diff = (targetLen - dist) / dist;

      if (i < HANDLE_SEGS) {
        b.x += dx * diff;
        b.y += dy * diff;
      } else {
        // Graduated constraint: stiffer near handle (a moves less), looser at tip
        const ct = (i - HANDLE_SEGS) / (TOTAL_SEGS - HANDLE_SEGS - 1);
        const aMove = 0.2 + ct * 0.3;  // 0.2 near handle → 0.5 at tip
        const bMove = 1 - aMove;
        a.x -= dx * diff * aMove;
        a.y -= dy * diff * aMove;
        b.x += dx * diff * bMove;
        b.y += dy * diff * bMove;
      }
    }
  }
}

// --- Strike animation ---

function startStrike(targetX, targetY) {
  isStriking = true;
  strikePhase = 1;
  strikeTimer = 0;
  strikeTargetX = targetX;
  strikeTargetY = targetY;
  sparkTimer = 0;
}

function applyStrikeForces() {
  strikeTimer++;

  const attach = getWhipAttachPos();
  const dx = strikeTargetX - attach.x;
  const dy = strikeTargetY - attach.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const dirX = dist > 0 ? dx / dist : 0;
  const dirY = dist > 0 ? dy / dist : 1;

  // Phase 1: Windup — handle lifts up+right, swings from 11 o'clock to ~2 o'clock (0-12 frames)
  if (strikePhase === 1) {
    handleTargetOffsetX = 80;
    handleTargetOffsetY = -100;
    handleTargetAngle = (75 * Math.PI) / 180; // +75° from rest (-30°) → total ~45° = ~1:30 o'clock

    // Whip trails up and to the right behind the raised handle
    for (let i = HANDLE_SEGS; i < TOTAL_SEGS; i++) {
      const t = (i - HANDLE_SEGS) / (TOTAL_SEGS - HANDLE_SEGS);
      const force = 5 * t;
      points[i].x += force * 1.2;  // strong rightward
      points[i].y -= force;         // upward
    }

    if (strikeTimer > 6) {
      strikePhase = 2;
      strikeTimer = 0;
    }
  }

  // Phase 2: Lash — handle swings down+left past rest, whip follows to target (0-10 frames)
  if (strikePhase === 2) {
    const progress = strikeTimer / 10;
    // Handle returns to rest position, then overshoots slightly down-left
    handleTargetOffsetX = 80 * (1 - progress * 1.3);
    handleTargetOffsetY = -100 * (1 - progress * 1.3);
    // Angle swings from ~2 o'clock back through 11 o'clock to ~9 o'clock
    handleTargetAngle = ((75 - progress * 120) * Math.PI) / 180;

    const waveFront = progress;
    for (let i = HANDLE_SEGS; i < TOTAL_SEGS; i++) {
      const t = (i - HANDLE_SEGS) / (TOTAL_SEGS - HANDLE_SEGS);
      const waveInfluence = Math.max(0, 1 - Math.abs(t - waveFront) * 4);

      const targetPosX = attach.x + dx * t;
      const targetPosY = attach.y + dy * t;

      const pullX = (targetPosX - points[i].x) * waveInfluence * 0.4;
      const pullY = (targetPosY - points[i].y) * waveInfluence * 0.4;
      points[i].x += pullX;
      points[i].y += pullY;
      points[i].ox = points[i].x - dirX * waveInfluence * 8;
      points[i].oy = points[i].y - dirY * waveInfluence * 8;
    }

    if (waveFront > 0.6) {
      const tip = points[TOTAL_SEGS - 1];
      const pullStrength = (waveFront - 0.6) * 2.5;
      tip.x += (strikeTargetX - tip.x) * pullStrength * 0.3;
      tip.y += (strikeTargetY - tip.y) * pullStrength * 0.3;
    }

    if (strikeTimer > 10) {
      points[TOTAL_SEGS - 1].x = strikeTargetX;
      points[TOTAL_SEGS - 1].y = strikeTargetY;
      strikePhase = 3;
      strikeTimer = 0;
      if (soundEnabled) playCrackSound();
      spawnEmojiParticles(strikeTargetX, strikeTargetY);
    }
  }

  // Phase 3: Hit — hold, handle settles (0-6 frames)
  if (strikePhase === 3) {
    sparkTimer = strikeTimer;
    handleTargetOffsetX = 0;
    handleTargetOffsetY = 0;
    handleTargetAngle = 0;

    const tip = points[TOTAL_SEGS - 1];
    tip.x += (strikeTargetX - tip.x) * 0.5;
    tip.y += (strikeTargetY - tip.y) * 0.5;

    if (strikeTimer > 6) {
      strikePhase = 4;
      strikeTimer = 0;
    }
  }

  // Phase 4: Recoil (0-12 frames)
  if (strikePhase === 4) {
    handleTargetOffsetX = 0;
    handleTargetOffsetY = 0;
    handleTargetAngle = 0;

    if (strikeTimer === 1) {
      const tip = points[TOTAL_SEGS - 1];
      tip.ox = tip.x + (strikeTargetX - attach.x) * 0.2;
      tip.oy = tip.y + (strikeTargetY - attach.y) * 0.2;
    }
    if (strikeTimer > 12) {
      isStriking = false;
      strikePhase = 0;
    }
  }
}

// --- Drawing ---

function drawWhip() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!whipEnabled || points.length === 0) return;

  // --- Handle (rigid brown stick, seg 0 = grip at bottom, last = top) ---
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < HANDLE_SEGS; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.strokeStyle = COLOR_HANDLE;
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Grip lines
  for (let i = 1; i < HANDLE_SEGS - 1; i += 2) {
    const p = points[i];
    const next = points[i + 1];
    const nx = -(next.y - p.y);
    const ny = next.x - p.x;
    const len = Math.sqrt(nx * nx + ny * ny);
    if (len > 0) {
      ctx.beginPath();
      ctx.moveTo(p.x - (nx / len) * 3.5, p.y - (ny / len) * 3.5);
      ctx.lineTo(p.x + (nx / len) * 3.5, p.y + (ny / len) * 3.5);
      ctx.strokeStyle = COLOR_HANDLE_GRIP;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  // Knob at grip end (seg 0, bottom)
  ctx.beginPath();
  ctx.arc(points[0].x, points[0].y, 5, 0, Math.PI * 2);
  ctx.fillStyle = COLOR_HANDLE_GRIP;
  ctx.fill();

  // Ferrule at whip end (top of handle)
  const lastHandle = points[HANDLE_SEGS - 1];
  ctx.beginPath();
  ctx.arc(lastHandle.x, lastHandle.y, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#666';
  ctx.fill();

  // --- Whip body (pink) ---

  // Shadow pass
  ctx.beginPath();
  ctx.moveTo(lastHandle.x, lastHandle.y);
  for (let i = HANDLE_SEGS; i < TOTAL_SEGS - 1; i++) {
    const xc = (points[i].x + points[i + 1].x) / 2;
    const yc = (points[i].y + points[i + 1].y) / 2;
    ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
  }
  const last = points[TOTAL_SEGS - 1];
  const secondLast = points[TOTAL_SEGS - 2];
  ctx.quadraticCurveTo(secondLast.x, secondLast.y, last.x, last.y);
  ctx.strokeStyle = COLOR_WHIP_SHADOW;
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Main pass
  ctx.beginPath();
  ctx.moveTo(lastHandle.x, lastHandle.y);
  for (let i = HANDLE_SEGS; i < TOTAL_SEGS - 1; i++) {
    const xc = (points[i].x + points[i + 1].x) / 2;
    const yc = (points[i].y + points[i + 1].y) / 2;
    ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
  }
  ctx.quadraticCurveTo(secondLast.x, secondLast.y, last.x, last.y);
  ctx.strokeStyle = COLOR_WHIP;
  ctx.lineWidth = 4;
  ctx.stroke();

  // Highlight pass
  const hlStart = HANDLE_SEGS + Math.floor(WHIP_SEGS * 0.3);
  ctx.beginPath();
  ctx.moveTo(points[hlStart].x, points[hlStart].y);
  for (let i = hlStart + 1; i < TOTAL_SEGS - 1; i++) {
    const xc = (points[i].x + points[i + 1].x) / 2;
    const yc = (points[i].y + points[i + 1].y) / 2;
    ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
  }
  ctx.quadraticCurveTo(secondLast.x, secondLast.y, last.x, last.y);
  ctx.strokeStyle = COLOR_WHIP_HIGHLIGHT;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Tip taper
  const tip = points[TOTAL_SEGS - 1];
  const preTip = points[TOTAL_SEGS - 2];
  const tdx = tip.x - preTip.x;
  const tdy = tip.y - preTip.y;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x + tdx * 0.5, tip.y + tdy * 0.5);
  ctx.strokeStyle = COLOR_WHIP_HIGHLIGHT;
  ctx.lineWidth = 1;
  ctx.stroke();

  // --- Hit effects ---
  if (strikePhase === 3) {
    if (currentMode === 'neutral') {
      drawSparks(strikeTargetX, strikeTargetY, sparkTimer);
    }
  }
  drawEmojiParticles();
}

function drawSparks(x, y, timer) {
  const count = 8;
  const spread = 5 + timer * 2;
  const alpha = Math.max(0, 1 - timer / 10);

  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + timer * 0.1;
    const len = spread + Math.random() * 10;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    ctx.strokeStyle = i % 2 === 0
      ? `rgba(235, 148, 245, ${alpha})`
      : `rgba(255, 215, 0, ${alpha})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(x, y, 3 + timer, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(235, 148, 245, ${alpha * 0.6})`;
  ctx.lineWidth = 2;
  ctx.stroke();
}

// --- Emoji particles ---

function spawnEmojiParticles(x, y) {
  let pool;
  if (currentMode === 'loving') pool = EMOJIS_LOVING;
  else if (currentMode === 'angry') pool = EMOJIS_ANGRY;
  else if (currentMode === 'mixed') pool = EMOJIS_MIXED;
  else return; // neutral = sparks only, no emojis

  const count = 6 + Math.floor(Math.random() * 4); // 6-9 emojis
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
    const speed = 2 + Math.random() * 4;
    emojiParticles.push({
      emoji: pool[Math.floor(Math.random() * pool.length)],
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 2, // slight upward bias
      life: 1.0,
      decay: 0.015 + Math.random() * 0.01,
      size: 20 + Math.random() * 16,
      rotation: (Math.random() - 0.5) * 0.3,
      rotationSpeed: (Math.random() - 0.5) * 0.1,
    });
  }
}

function drawEmojiParticles() {
  for (let i = emojiParticles.length - 1; i >= 0; i--) {
    const p = emojiParticles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.08; // gravity
    p.vx *= 0.98; // drag
    p.life -= p.decay;
    p.rotation += p.rotationSpeed;

    if (p.life <= 0) {
      emojiParticles.splice(i, 1);
      continue;
    }

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rotation);
    ctx.globalAlpha = Math.min(1, p.life * 2); // fade out in last 50%
    ctx.font = `${p.size}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.emoji, 0, 0);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

// --- Animation loop ---

function loop() {
  updatePhysics();
  drawWhip();
  animationId = requestAnimationFrame(loop);
}

// --- Sound ---

let sharedAudioCtx = null;

function getAudioContext() {
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    sharedAudioCtx = new AudioContext();
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume();
  }
  return sharedAudioCtx;
}

function playCrackSound() {
  const audioCtx = getAudioContext();
  const duration = 0.2;
  const buffer = audioCtx.createBuffer(1, audioCtx.sampleRate * duration, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < data.length; i++) {
    const t = i / audioCtx.sampleRate;
    const crack = Math.exp(-t * 35) * (Math.random() * 2 - 1);
    const pop = Math.exp(-t * 80) * Math.sin(t * 3000) * 0.3;
    data[i] = (crack + pop) * 0.4;
  }

  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(audioCtx.destination);
  source.start();
}

// --- Canvas ---

function createCanvas() {
  canvas = document.createElement('canvas');
  canvas.id = 'whip-canvas';
  canvas.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    pointer-events: none;
    z-index: 999999;
  `;
  document.body.appendChild(canvas);
  ctx = canvas.getContext('2d');
  resizeCanvas();
}

function resizeCanvas() {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.style.width = window.innerWidth + 'px';
  canvas.style.height = window.innerHeight + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

window.addEventListener('resize', resizeCanvas);

// --- Toggle ---

function setWhipMode(enabled) {
  whipEnabled = enabled;
  chrome.storage.local.set({ whipEnabled: enabled });

  if (enabled) {
    if (!canvas) createCanvas();
    canvas.style.display = 'block';
    handleAnimOffsetX = 0;
    handleAnimOffsetY = 0;
    handleAnimAngle = 0;
    handleTargetOffsetX = 0;
    handleTargetOffsetY = 0;
    handleTargetAngle = 0;
    initRope();
    if (!animationId) loop();
  } else {
    if (canvas) {
      canvas.style.display = 'none';
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
  }
}

// --- Events ---

document.addEventListener('mousemove', (e) => {
  mouseX = e.clientX;
  mouseY = e.clientY;
});

document.addEventListener('click', (e) => {
  if (whipEnabled && !isStriking) {
    startStrike(e.clientX, e.clientY);
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'toggle') {
    setWhipMode(msg.enabled);
  }
  if (msg.action === 'setMode') {
    currentMode = msg.mode;
    chrome.storage.local.set({ whipMode: msg.mode });
  }
  if (msg.action === 'setSound') {
    soundEnabled = msg.enabled;
    chrome.storage.local.set({ soundEnabled: msg.enabled });
  }
});

document.addEventListener('keydown', (e) => {
  if (e.altKey && e.key === 'w') {
    e.preventDefault();
    setWhipMode(!whipEnabled);
  }
});

chrome.storage.local.get(['whipEnabled', 'whipMode', 'soundEnabled'], (data) => {
  if (data.whipMode) currentMode = data.whipMode;
  if (data.soundEnabled !== undefined) soundEnabled = data.soundEnabled;
  if (data.whipEnabled) setWhipMode(true);
});
