// MONSOON STRIKE boot and the one loop: a fixed 60 Hz simulation feeding a render
// at the display's rate. ?shot=start|play|end with &seed=N sets up a
// deterministic frame for a capture, renders it twice, then freezes it and
// sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32 } from './rng.js';
import { createWorld, updateRain, SPAWNS } from './world.js';
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

const world = createWorld(scene, random);
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
  // Recoil lives in its own offset (player.js) so the camera shows the kick
  // while the base pitch recovers underneath it.
  camera.rotation.set(body.pitch + (body.recoil || 0), body.yaw, 0, 'YXZ');
  // ADS narrows the field of view; hipfire stays wide.
  const targetFov = body.ads ? 52 : 74;
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov += (targetFov - camera.fov) * 0.35;
    if (Math.abs(camera.fov - targetFov) < 0.5) camera.fov = targetFov;
    camera.updateProjectionMatrix();
  }
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
  world.lampLight3.intensity = blackout ? 0 : 22;
  // The fills and the lamp heads were never driven before: the warm south
  // fill and the cool north fill both die down in a blackout, so the mid
  // containers' north faces no longer go near-black in normal play.
  world.fill.intensity = blackout ? 0.1 : 0.45;
  world.fillNorth.intensity = blackout ? 0.08 : 0.35;
  world.lampMat.emissiveIntensity = blackout ? 0.1 : 1.6;
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
    else if (event.type === 'died') {
      // Death used to be silent: no banner, no feed, pointer lock held.
      hud.banner('ELIMINATED', `Taken down by ${event.killer || 'the enemy'}`, 'bad');
      hud.killfeed(`You were eliminated by ${event.killer || 'the enemy'}`, 'reaver');
      hud.showOverlay('dead');
      input.exitLock();
    }
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
  hud.setCrosshair(4 + weapon.spread(player.groundSpeed(), body.crouching, body.aiming, body.ads) * 900);
  const charge = sim.state.charge;
  if (sim.state.phase === 'roundOver' || sim.state.phase === 'matchOver') {
    // A finished round carries no charge line: the v1 end shot showed a
    // stale "YOU CARRY THE CHARGE" under a ROUND WON banner.
    hud.setCharge('');
  } else if (charge.planted) {
    // Under 10 s and close to the charge, the line is a warning: the blast
    // kills anyone standing on the site, planter included.
    const d = Math.hypot(body.position.x - charge.x, body.position.z - charge.z);
    if (charge.timer < 10 && d < 7) {
      hud.setCharge(`⚠ CHARGE BLOWS IN ${Math.ceil(charge.timer)}s — GET CLEAR`);
    } else {
      hud.setCharge(`CHARGE PLANTED — ${charge.site} · ${Math.ceil(charge.timer)}s`);
    }
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
  // B opens the menu only in the buy phase, but closes it in any phase;
  // Esc closes it too. The menu used to stay open for the whole live round.
  if (input.takePressed('KeyB')) {
    if (buyOpen) {
      buyOpen = false;
      hud.showBuy(false);
    } else if (sim.state.phase === 'buy') {
      buyOpen = true;
      hud.showBuy(true);
    }
  }
  if (input.takePressed('Escape') && buyOpen) {
    buyOpen = false;
    hud.showBuy(false);
  }
  // Q or the scroll wheel swaps to the permanent P9 sidearm (and back).
  if ((input.takePressed('KeyQ') || input.takeSwitch()) && body.alive) weapon.toggleSecondary();
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

let prevPhase = 'buy';
function step(dt) {
  // Right-mouse ADS lives here (not only in frame()) so it also applies to
  // deterministic settle() advances: tighter spread, narrower FOV, raised gun.
  body.ads = input.state.aiming;
  weapon.setAds(input.state.aiming);
  // The player can always move — including during the 8 s buy phase, when
  // v1 froze them. Only buying and firing are gated on phase.
  player.step(dt, input.state.keys);
  weapon.step(dt);
  sim.step(dt, input.state.keys);
  // The buy menu closes itself when the buy phase ends.
  if (prevPhase === 'buy' && sim.state.phase === 'live' && buyOpen) {
    buyOpen = false;
    hud.showBuy(false);
  }
  prevPhase = sim.state.phase;
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
    body.position.set(SPAWNS.sentinel[1][0], 0, SPAWNS.sentinel[1][1]);
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
    sim.state.liveStart = sim.state.time;
    settle(6);
    const reaver = bots.list.find((b) => b.team === 'reaver');
    // Open ground in front of the mid container: the old spot left the
    // target half-hidden behind it, head and torso only. Hold still for
    // the frame so the staged shot lands instead of chasing a strafing bot.
    reaver.group.position.set(-2.5, 0, 3.5);
    reaver.deployed = true;
    reaver.state = 'hold';
    reaver.holdLeft = 30;
    reaver.target = null;
    const mate = bots.list.find((b) => b.team === 'sentinel');
    mate.group.position.set(-3.5, 0, 5.5);
    mate.deployed = true;
    mate.state = 'hold';
    mate.holdLeft = 30;
    mate.target = null;
    body.position.set(0, 0, 12);
    settle(0.1);
    // Aim last, at the target's position now: aiming before the settle let
    // the bot walk out of the shot in 0.1 s and the tracer went to the
    // screen edge on a miss.
    const target = bots.list.filter((b) => b.team === 'reaver' && b.alive)[0];
    aimAt(target.group.position.x, 1.35, target.group.position.z);
    sim.playerShoot();
    sim.state.flash = 0.5;
    // The muzzle flash lives 0.06 s and only becomes visible when
    // weapon.step runs — set it after the settle, right before the
    // capture, so the frame actually holds the flash.
    weapon.state.flash = 0.06;
    weapon.step(0);
    drainEvents();
    syncHud();
    syncCamera();
  } else {
    // Round end, honestly staged: every Reaver is actually dead before the
    // round ends, so the alive counts and the charge line agree with the
    // ROUND WON banner. Two surviving Sentinels hold Site A in the frame.
    sim.state.phase = 'live';
    sim.state.roundTime = 61;
    settle(2);
    for (const b of bots.list) {
      if (b.team === 'reaver') {
        b.alive = false;
        b.health = 0;
        b.group.visible = false;
      }
    }
    const mates = bots.list.filter((b) => b.team === 'sentinel' && b.alive);
    // Shoot from south of the hall wall's south end, looking north across
    // the pad at both survivors: the camera sits clear of the hall walls,
    // the right-edge rays pass through the x=-14 wall gap, and the A-sign
    // pole enters the frame right-of-centre. The open mid map, the lamp
    // and the sky are the background; the west wall is lit, not a dark slab.
    body.position.set(-15.5, 0, -1.5);
    aimAt(-17.5, 1.2, -11);
    // Hold still for the frame, facing the camera, with Site A behind them.
    if (mates[0]) { mates[0].group.position.set(-15, 0, -8.5); mates[0].deployed = true; mates[0].state = 'hold'; mates[0].holdLeft = 30; mates[0].target = null; }
    if (mates[1]) { mates[1].group.position.set(-20.5, 0, -10.5); mates[1].deployed = true; mates[1].state = 'hold'; mates[1].holdLeft = 30; mates[1].target = null; }
    // Face the camera: a bot's forward is its local -z, so the yaw that
    // looks at the camera is atan2 of the negated offset to it.
    for (const mate of mates) {
      mate.yaw = Math.atan2(-(body.position.x - mate.group.position.x), -(body.position.z - mate.group.position.z));
      mate.group.rotation.y = mate.yaw;
    }
    // The view model used to cover the right-hand mate; the end frame is
    // about the team, not the gun.
    weapon.setModelVisible(false);
    sim.endRound('sentinel', 'Enemy team eliminated');
    drainEvents();
    syncHud();
    hud.reassertBanner();
    reassertEndFeed();
    settle(0.2);
    // Lightning flash after the settle: updateLightning decays flash at
    // 2.2/s during steps, so setting it before the settle would fade it
    // out before the capture.
    sim.state.flash = 0.5;
    hud.reassertBanner();
    reassertEndFeed();
  }
  syncHud();
  paintTwiceThenReady();
}

function reassertEndFeed() {
  // Kill-feed entries fade on a wall-clock timer that can expire before a
  // slow headless capture. Clear the feed, then re-add the two kill
  // entries: the old empty-check let a still-alive callout (e.g. the
  // "flanking A!" line) block them for the whole capture.
  const feed = document.getElementById('killfeed');
  if (!feed) return;
  const want = ['You  ✕  Rook  (headshot)', 'Arif  ✕  Sable'];
  const have = [...feed.children].map((el) => el.textContent);
  if (have.length === want.length && have.every((text, i) => text === want[i])) return;
  feed.replaceChildren();
  hud.killfeed(want[0], 'sentinel');
  hud.killfeed(want[1], 'sentinel');
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    updateRain(world, camera, 0.05);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    // Wall-clock banner/killfeed timers can fade before capture; re-assert
    // the banner on each paint so the end frame keeps it.
    if (shot === 'end') {
      hud.reassertBanner();
      reassertEndFeed();
    }
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
  sim, player, weapon, bots, input, hud, audio, renderer,
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
