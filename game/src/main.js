// MONSOON STRIKE boot and the one loop: a fixed 60 Hz simulation feeding a render
// at the display's rate. ?shot=start|play|end with &seed=N sets up a
// deterministic frame for a capture, renders it twice, then freezes it and
// sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32 } from './rng.js';
import { createWorld, updateRain } from './world.js';
import { createPlayer } from './player.js';
import { createWeapon } from './weapons.js';
import { createBots } from './bots.js';
import { createSim } from './sim.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 20, 62);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const player = createPlayer(world.colliders);
const weapon = createWeapon(camera);
const bots = createBots(scene, world, random);
const audio = createAudio();
const hud = createHud();
const input = createInput(renderer.domElement, onLockChange);
const sim = createSim({ scene, camera, world, player, weapon, bots, audio, rng: random });

const body = player.state;
let started = false;
let buyOpen = false;
let frozen = false;
let accumulator = 0;
let lastTime = performance.now();
let prevFiring = false;
let stepDistance = 0;
let lastPosX = body.position.x;
let lastPosZ = body.position.z;

hud.setHealth(100);
hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.state.def.name, 0);
hud.setMoney(sim.state.money);
hud.setScore(0, 0, 1);
hud.setMuted(false);
sim.startRound();

hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  audio.rain();
  if (sim.state.phase === 'matchOver') return;
  input.requestLock();
});
hud.onRestart(() => {
  audio.unlock();
  audio.rain();
  sim.resetMatch();
  hud.hideMatch();
  hud.hideOverlay();
  input.requestLock();
});

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
  } else if (sim.state.phase === 'matchOver') {
    hud.showMatch(sim.state.score.sentinel >= 5, sim.state.score);
  } else if (!body.alive) {
    hud.showOverlay('dead');
  } else {
    hud.showOverlay(started ? 'paused' : 'start');
  }
}

function syncCamera() {
  const shake = sim.state.shake;
  const sx = shake > 0 ? (random() * 2 - 1) * shake * 0.05 : 0;
  const sy = shake > 0 ? (random() * 2 - 1) * shake * 0.05 : 0;
  camera.position.set(body.position.x + sx, body.position.y + body.eye + sy, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
  applyLighting();
}

// The monsoon light rig: during a blackout the street lamps and the moon
// die down to almost nothing and the lightning flash is the only key light,
// so muzzle flashes and tracers carry the scene.
const flashEl = document.getElementById('flash');
function applyLighting() {
  const blackout = sim.state.blackout.active;
  const flash = sim.state.flash;
  world.hemi.intensity = blackout ? 0.22 : 0.85;
  world.moon.intensity = blackout ? 0.25 : 1.1;
  world.lampLight1.intensity = blackout ? 0 : 22;
  world.lampLight2.intensity = blackout ? 0 : 22;
  world.lightning.intensity = flash * 9;
  if (flashEl) flashEl.style.opacity = String(flash * 0.25);
}

function aimAt(x, y, z) {
  const dx = x - body.position.x;
  const dy = y - (body.position.y + body.eye);
  const dz = z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function drainEvents() {
  for (const event of sim.drainEvents()) {
    if (event.type === 'killfeed') hud.killfeed(event.text, event.team);
    else if (event.type === 'hitmarker') hud.hitMarker(event.head, event.kill);
    else if (event.type === 'damage') hud.damageFrom(event.angle);
    else if (event.type === 'banner') hud.banner(event.title, event.sub, event.tone);
    else if (event.type === 'match') {
      hud.showMatch(event.winner === 'sentinel', event.score);
      input.exitLock();
    }
  }
}

function syncHud() {
  hud.setHealth(body.health);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.state.def.name.toUpperCase(), weapon.state.grenades);
  hud.setMoney(sim.state.money);
  hud.setScore(sim.state.score.sentinel, sim.state.score.reaver, sim.state.round);
  hud.setTimer(sim.state.phase === 'buy' ? sim.state.buyTime : sim.state.roundTime, sim.state.phase === 'live');
  hud.setAlive(bots.aliveCount('sentinel') + (body.alive ? 1 : 0), bots.aliveCount('reaver'));
  hud.setCrosshair(4 + weapon.spread(player.groundSpeed(), body.crouching, body.aiming) * 900);
  const charge = sim.state.charge;
  if (charge.planted) {
    hud.setCharge(`CHARGE PLANTED — ${charge.site} · ${Math.ceil(charge.timer)}s`);
  } else if (charge.carrier === 'player') {
    hud.setCharge('YOU CARRY THE CHARGE — hold E at a site');
  } else if (charge.carrier) {
    hud.setCharge('TEAMMATE CARRIES THE CHARGE');
  } else {
    hud.setCharge('');
  }
  if (sim.state.plantProgress > 0) {
    hud.setPlant(sim.state.plantProgress / 3, 'PLANTING');
  } else {
    hud.setPlant(0);
  }
  if (buyOpen) {
    hud.updateBuy(weapon.state.def.id, sim.state.money);
    document.getElementById('buy-round').textContent = String(sim.state.round);
  }
}

function handleKeys() {
  if (input.takePressed('KeyB') && sim.state.phase === 'buy') {
    buyOpen = !buyOpen;
    hud.showBuy(buyOpen);
  }
  if (input.takePressed('KeyM')) hud.setMuted(audio.toggleMute());
  if (buyOpen) {
    const buys = { Digit1: 'megh7', Digit2: 'jol9', Digit3: 'bijli50', Digit4: 'p9', Digit5: 'grenade' };
    for (const [code, id] of Object.entries(buys)) {
      if (input.takePressed(code)) sim.buy(id);
    }
  } else if (input.takePressed('KeyG')) {
    sim.throwGrenade();
  }
  if (input.takePressed('KeyR') && weapon.reload()) audio.reload();
}

function step(dt) {
  if (sim.state.phase !== 'buy') player.step(dt, input.state.keys);
  weapon.step(dt);
  sim.step(dt, input.state.keys);
  // Footsteps: one soft tick every ~2.2 m of ground travel.
  if (body.onGround && body.alive) {
    const moved = Math.hypot(body.position.x - lastPosX, body.position.z - lastPosZ);
    stepDistance += moved;
    if (stepDistance > 2.2) {
      stepDistance = 0;
      audio.step();
    }
  }
  lastPosX = body.position.x;
  lastPosZ = body.position.z;
  drainEvents();
  syncHud();
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    player.look(look.x, look.y);
    handleKeys();
    const firing = input.state.firing;
    const edge = firing && !prevFiring;
    prevFiring = firing;
    if (body.alive && sim.state.phase === 'live' && (weapon.state.def.auto ? firing : edge) && weapon.ready()) {
      sim.playerShoot();
    }
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    updateRain(world, camera, dt);
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(seconds) {
  syncCamera();
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function runShot(name) {
  hud.hideOverlay();
  hud.hideMatch();
  audio.unlock();
  if (name === 'start') {
    // Buy phase at the Sentinel spawn, buy menu open, looking up mid.
    body.position.set(0, 0, 15.5);
    body.yaw = 0;
    body.pitch = 0;
    settle(0.5);
    aimAt(0, 1.4, -6);
    buyOpen = true;
    hud.showBuy(true);
    hud.updateBuy(weapon.state.def.id, sim.state.money);
    hud.setCharge('YOU CARRY THE CHARGE — hold E at a site');
  } else if (name === 'play') {
    // Mid-combat: jump the round live, march the bots forward, then fire at
    // the nearest Reaver so the frame holds a tracer, a muzzle flash and a
    // live HUD. A lightning flash lights the wet street for the capture.
    sim.state.phase = 'live';
    sim.state.roundTime = 92;
    sim.state.buyTime = 0;
    settle(6);
    const reaver = bots.list.find((b) => b.team === 'reaver');
    reaver.group.position.set(-2.5, 0, 2);
    const mate = bots.list.find((b) => b.team === 'sentinel');
    mate.group.position.set(-3.5, 0, 8);
    body.position.set(0, 0, 12);
    const target = bots.list.filter((b) => b.team === 'reaver' && b.alive)[0];
    aimAt(target.group.position.x, 1.35, target.group.position.z);
    settle(0.1);
    sim.playerShoot();
    sim.state.flash = 0.5;
    drainEvents();
    syncHud();
    syncCamera();
  } else {
    // Round end: a won round with the banner and the kill feed up.
    sim.state.phase = 'live';
    sim.state.roundTime = 61;
    settle(2);
    body.position.set(-6, 0, 6);
    aimAt(-17, 1.5, -9);
    hud.killfeed('You  ✕  Rook  (headshot)', 'sentinel');
    hud.killfeed('Arif  ✕  Sable', 'sentinel');
    sim.endRound('sentinel', 'Enemy team eliminated');
    drainEvents();
    syncHud();
    settle(0.2);
  }
  syncHud();
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    updateRain(world, camera, 0.05);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Debug / playtest hook: lets a headless driver inspect and drive the sim.
window.__game = {
  sim, player, weapon, bots, input, hud, audio,
  // Advance the fixed-step sim deterministically, without waiting on rAF.
  advance(seconds) { settle(seconds); },
  fire() {
    if (body.alive && sim.state.phase === 'live' && weapon.ready()) sim.playerShoot();
  },
};

syncCamera();
syncHud();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
