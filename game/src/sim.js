// MONSOON STRIKE simulation: the one central state object. Rounds, economy, the
// charge objective, hitscan combat for the player and the bots, grenades and
// tracers all live here, stepped at a fixed 60 Hz by main.js. Rendering and
// the DOM never touch this state directly; sim pushes events out and main
// forwards them to the HUD and the audio.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { WEAPONS, GRENADE_PRICE, GRENADE_FUSE, GRENADE_RADIUS, GRENADE_DAMAGE } from './weapons.js';
import { SITES, SPAWNS } from './world.js';

const ROUND_TIME = 100;
const BUY_TIME = 8;
const PLANT_TIME = 3;
const DEFUSE_TIME = 4;
const CHARGE_TIMER = 40;
const WIN_ROUNDS = 5;
const KILL_REWARD = 300;
const WIN_REWARD = 3000;
const LOSS_REWARD = 1500;

const _dir = new THREE.Vector3();
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _proj = new THREE.Vector3();
const _proj2 = new THREE.Vector3();
// Reused ray target list: shootables plus live bot hitboxes, rebuilt per
// shot without a concat allocation.
const _targets = [];

export function createSim({ scene, camera, world, player, weapon, bots, audio, rng }) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 140;

  // Tracer pool: 8 reusable thin boxes stretched between muzzle and hit,
  // brighter than a 1px line and with no allocation in the hot loop.
  const tracers = [];
  for (let i = 0; i < 8; i += 1) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.02, 1),
      new THREE.MeshBasicMaterial({ color: 0xffc861, transparent: true, opacity: 0, depthWrite: false }),
    );
    mesh.visible = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    tracers.push({ mesh, life: 0 });
  }
  let tracerIndex = 0;
  function tracer(from, to, color = 0xffc861) {
    // A tracer whose both ends project outside the camera frustum reads as
    // a scratch across the whole frame (off-screen shooter to off-screen
    // target), so skip it: a bullet nobody can see the ends of is not drawn.
    // The matrices must be fresh: in a staged capture no render has run yet.
    camera.updateMatrixWorld();
    _proj.copy(from).project(camera);
    const fromIn = _proj.x > -1.05 && _proj.x < 1.05 && _proj.y > -1.05 && _proj.y < 1.05 && _proj.z > -1 && _proj.z < 1;
    _proj2.copy(to).project(camera);
    const toIn = _proj2.x > -1.05 && _proj2.x < 1.05 && _proj2.y > -1.05 && _proj2.y < 1.05 && _proj2.z > -1 && _proj2.z < 1;
    if (!fromIn && !toIn) return;
    // One end at or past the screen edge and a projected span wider than
    // ~85% of the frame is the same scratch in the other direction: a line
    // from a half-seen shooter to a target past the far edge crosses the
    // whole screen with no visible anchor at one end. A long shot with
    // both ends comfortably in frame keeps its anchors and still draws.
    const spanX = Math.abs(_proj.x - _proj2.x);
    const spanY = Math.abs(_proj.y - _proj2.y);
    const edgeEnd = Math.abs(_proj.x) > 0.95 || Math.abs(_proj.y) > 0.95 || Math.abs(_proj2.x) > 0.95 || Math.abs(_proj2.y) > 0.95;
    if (edgeEnd && (spanX > 1.7 || spanY > 1.7)) return;
    const t = tracers[tracerIndex];
    tracerIndex = (tracerIndex + 1) % tracers.length;
    const len = from.distanceTo(to);
    t.mesh.position.copy(from).lerp(to, 0.5);
    t.mesh.lookAt(to);
    t.mesh.scale.set(1, 1, Math.max(0.01, len));
    t.mesh.material.color.setHex(color);
    t.mesh.material.opacity = 0.9;
    t.mesh.visible = true;
    t.life = 0.09;
  }

  // Explosion visual: one reusable sphere + light.
  const boom = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0 }),
  );
  boom.visible = false;
  scene.add(boom);
  const boomLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 26);
  scene.add(boomLight);
  let boomLife = 0;

  // Planted charge mesh.
  const chargeMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.28, 0.34),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.charge), emissive: new THREE.Color(PALETTE.charge), emissiveIntensity: 0.7, roughness: 0.5 }),
  );
  chargeMesh.visible = false;
  chargeMesh.castShadow = true;
  scene.add(chargeMesh);
  const chargeLight = new THREE.PointLight(new THREE.Color(PALETTE.charge), 0, 9);
  scene.add(chargeLight);

  const grenades = [];
  for (let i = 0; i < 4; i += 1) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 10, 8),
      new THREE.MeshStandardMaterial({ color: new THREE.Color('#22262d'), roughness: 0.5, metalness: 0.5 }),
    );
    mesh.visible = false;
    scene.add(mesh);
    grenades.push({ mesh, pos: new THREE.Vector3(), vel: new THREE.Vector3(), fuse: 0, active: false });
  }

  const state = {
    phase: 'buy',
    round: 1,
    score: { sentinel: 0, reaver: 0 },
    roundTime: ROUND_TIME,
    buyTime: BUY_TIME,
    phaseTime: 0,
    money: 1500,
    charge: { carrier: 'player', planted: false, x: 0, z: 0, site: null, timer: CHARGE_TIMER, beep: 0 },
    plantProgress: 0,
    playerKills: 0,
    shake: 0,
    time: 0,
    // Monsoon twist: lightning strikes cut the street lights for a few
    // seconds (blackout). Muzzle flashes and tracers become the main light,
    // and bots shoot worse in the dark.
    flash: 0,
    blackout: { active: false, timer: 0, nextStrike: 16 + rng() * 10, flickerDone: false },
    // Last-man-standing grace: the moment the player becomes the only
    // living sentinel, reavers hold for 5 s instead of instantly
    // converging on them. graceDone fires it once per round.
    graceUntil: 0,
    graceDone: false,
    // Spawn protection: liveStart is set when a round goes live; the
    // player takes no damage in the first 4 s of live play.
    liveStart: 0,
  };
  const events = [];

  function emit(event) { events.push(event); }

  function los(fromPos, toPos) {
    _dir.subVectors(toPos, fromPos);
    const dist = _dir.length();
    if (dist < 0.01) return true;
    _dir.multiplyScalar(1 / dist);
    raycaster.set(fromPos, _dir);
    raycaster.far = dist;
    return raycaster.intersectObjects(world.shootables, false).length === 0;
  }

  function eyePosOf(entity) {
    if (entity.kind === 'player') {
      _eye.set(player.state.position.x, player.state.position.y + player.state.eye, player.state.position.z);
    } else {
      _eye.set(entity.bot.group.position.x, 1.35, entity.bot.group.position.z);
    }
    return _eye;
  }

  function damagePlayer(amount, fromPos, killer = 'the enemy') {
    if (!player.state.alive || state.phase !== 'live') return;
    // Spawn protection: no damage in the first 4 s after the round goes
    // live, so the opening crossfire cannot melt a player who has not
    // even reached cover yet.
    if (state.time - state.liveStart < 4) return;
    player.state.health -= amount;
    audio.hurt();
    const dx = fromPos.x - player.state.position.x;
    const dz = fromPos.z - player.state.position.z;
    const worldAngle = Math.atan2(dx, dz);
    const relative = worldAngle - player.state.yaw;
    emit({ type: 'damage', angle: relative, amount });
    if (player.state.health <= 0) {
      player.state.health = 0;
      player.state.alive = false;
      emit({ type: 'died', killer });
      dropCharge();
      checkRoundEnd();
    }
  }

  function damageBot(bot, amount, killer) {
    if (!bot.alive) return false;
    bot.health -= amount;
    bot.lastHeard = null;
    // Flinch: a hit interrupts the bot's burst mid-fire, so it must
    // re-aim before shooting again instead of beaming through damage.
    if (bot.state === 'engage') {
      bot.burstLeft = 0;
      bot.burstPause = 0.5;
    }
    if (bot.health <= 35 && bot.state !== 'engage') {
      bot.state = 'cover';
      bot.stateTime = 0;
      // Fall back to the nearest waypoint behind the bot, away from the shooter.
      const away = nearestWaypointAway(bot);
      if (away >= 0) bots.setPath(bot, away);
    }
    if (bot.health <= 0) {
      bot.health = 0;
      bot.alive = false;
      bot.group.visible = false;
      bot.target = null;
      if (bot.hasCharge) {
        bot.hasCharge = false;
        // A teammate picks the charge up and carries on to a site.
        const carrier = bots.list.find((b) => b.alive && b.team === 'sentinel');
        if (carrier) {
          carrier.hasCharge = true;
          state.charge.carrier = carrier.id;
          bots.setPath(carrier, carrier.id.endsWith('0') ? 7 : 19);
          emit({ type: 'killfeed', text: `${carrier.name} picked up the charge`, team: 'sentinel' });
        } else {
          state.charge.carrier = null;
        }
      }
      return true;
    }
    return false;
  }

  function nearestWaypointAway(bot) {
    const { waypoints } = world;
    let best = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < waypoints.length; i += 1) {
      const dx = waypoints[i][0] - bot.group.position.x;
      const dz = waypoints[i][1] - bot.group.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 4 && d < 16) {
        const score = d + rng() * 4;
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      }
    }
    return best;
  }

  function dropCharge() {
    if (state.charge.carrier !== 'player' || state.charge.planted) return;
    state.charge.carrier = null;
    const carrier = bots.list.find((b) => b.alive && b.team === 'sentinel');
    if (carrier) {
      carrier.hasCharge = true;
      state.charge.carrier = carrier.id;
      bots.setPath(carrier, 7);
      emit({ type: 'killfeed', text: `${carrier.name} picked up the charge`, team: 'sentinel' });
    }
  }

  function killfeed(killerName, victimName, head, killerTeam) {
    emit({ type: 'killfeed', text: `${killerName}  ✕  ${victimName}${head ? '  (headshot)' : ''}`, team: killerTeam });
  }

  // ---- player shooting: one hitscan ray against bot hitboxes and the world ----
  function playerShoot() {
    const def = weapon.state.def;
    if (!weapon.takeRound()) {
      audio.dryFire();
      return;
    }
    const spread = weapon.spread(player.groundSpeed(), player.state.crouching, player.state.aiming, player.state.ads);
    camera.getWorldDirection(_dir);
    _dir.x += (rng() * 2 - 1) * spread;
    _dir.y += (rng() * 2 - 1) * spread;
    _dir.z += (rng() * 2 - 1) * spread;
    _dir.normalize();
    // Bots move between renders, so refresh world matrices before the ray —
    // otherwise the ray tests where they were, not where they are.
    scene.updateMatrixWorld(true);
    raycaster.set(camera.position, _dir);
    raycaster.far = def.range;
    _targets.length = 0;
    for (const s of world.shootables) _targets.push(s);
    for (const bot of bots.list) {
      if (bot.alive) _targets.push(bot.headMesh, bot.torsoMesh);
    }
    const hits = raycaster.intersectObjects(_targets, false);
    // First hit that counts: world geometry, or an enemy bot. Teammates are
    // never valid targets — a shot through a teammate keeps flying.
    let hit = null;
    for (const candidate of hits) {
      if (candidate.object.userData.bot && candidate.object.userData.bot.team === 'sentinel') continue;
      hit = candidate;
      break;
    }
    const muzzle = weapon.muzzleWorld(_from);
    if (hit) {
      tracer(muzzle, hit.point);
      if (hit.object.userData.bot) {
        const bot = hit.object.userData.bot;
        const head = hit.object.userData.part === 'head';
        const damage = def.damage * (head ? def.headMult : 1);
        const killed = damageBot(bot, damage, 'player');
        audio.hit(head);
        emit({ type: 'hitmarker', head, kill: killed });
        if (killed) {
          state.money += KILL_REWARD;
          state.playerKills += 1;
          audio.kill();
          killfeed('You', bot.name, head, 'sentinel');
          checkRoundEnd();
        }
      }
    } else {
      _to.copy(camera.position).addScaledVector(_dir, def.range);
      tracer(muzzle, _to);
    }
    weapon.pullTrigger();
    audio.shot(def.kind); // the player's own gun was silent before this
    player.recoil(def.kick * (0.8 + rng() * 0.4), (rng() * 2 - 1) * def.kick * 0.35);
    state.shake = Math.max(state.shake, def.kind === 'marksman' ? 0.35 : 0.12);
    bots.hearShot(player.state.position, state.time);
    emit({ type: 'ammo' });
  }

  // ---- bot shooting: burst fire resolved by line of sight + accuracy roll ----
  function botShoot(bot, target) {
    const from = _from.set(bot.group.position.x, 1.35, bot.group.position.z);
    const targetPos = eyePosOf(target);
    _to.copy(targetPos);
    if (!los(from, _to)) return;
    const dist = from.distanceTo(_to);
    let chance = 0.5 - dist * 0.008;
    if (bot.moving) chance -= 0.14;
    if (target.kind === 'player' && player.groundSpeed() > 2) chance -= 0.1;
    if (bot.state === 'engage' && bot.burstLeft > 0) chance += 0.05;
    if (state.blackout.active) chance -= 0.08; // bots shoot worse in the dark
    // Reavers hold their angles while sentinels walk into them, so
    // reaver-vs-bot accuracy is shaved a little: bot fights should be
    // winnable for either side without the player carrying them.
    if (target.kind !== 'player' && bot.team === 'reaver') chance -= 0.05;
    // Long-range crossfire melted the player in the opening seconds, so
    // accuracy falls off hard past 15 m against the player.
    if (target.kind === 'player') chance -= Math.max(0, dist - 15) * 0.012;
    chance = Math.max(0.05, Math.min(0.7, chance));
    // Accuracy ramp: a bot's first shots at the player land at 55% of
    // base chance, reaching full accuracy only after 5 s of sustained
    // engagement — an idle player is not instantly beamed.
    if (target.kind === 'player') chance *= 0.55 + 0.45 * Math.min(1, bot.engageTime / 5);
    tracer(from, _to, bot.team === 'reaver' ? 0xff7a5c : 0x7adfff);
    audio.shot('bot');
    bots.hearShot(from, state.time);
    if (rng() < chance) {
      // Focused bot fire would melt the player in seconds, so hits on the
      // player deal under half damage; bot-on-bot damage is full. A
      // stationary player takes less still: bots test a stationary target
      // before committing to it.
      let damage = 8 + rng() * 7;
      if (target.kind === 'player') {
        damage *= 0.45 * (dist > 18 ? 0.7 : 1);
        if (player.groundSpeed() < 0.5) damage *= 0.7;
      }
      if (target.kind === 'player') {
        damagePlayer(damage, from, bot.name);
      } else {
        const killed = damageBot(target.bot, damage, bot);
        if (killed) killfeed(bot.name, target.bot.name, false, bot.team);
        if (killed) checkRoundEnd();
      }
    }
  }

  function throwGrenade() {
    if (weapon.state.grenades <= 0 || state.phase !== 'live') return false;
    const slot = grenades.find((g) => !g.active);
    if (!slot) return false;
    weapon.state.grenades -= 1;
    camera.getWorldDirection(_dir);
    slot.pos.copy(camera.position);
    slot.vel.copy(_dir).multiplyScalar(16);
    slot.vel.y += 3.5;
    slot.fuse = GRENADE_FUSE;
    slot.active = true;
    slot.mesh.visible = true;
    slot.mesh.position.copy(slot.pos);
    audio.grenadeThrow();
    emit({ type: 'ammo' });
    return true;
  }

  function explode(pos) {
    boom.position.copy(pos);
    boom.visible = true;
    boomLife = 0.5;
    boomLight.position.copy(pos);
    boomLight.position.y += 1;
    boomLight.intensity = 60;
    audio.explosion();
    state.shake = 1;
    emit({ type: 'explosion', x: pos.x, y: pos.y, z: pos.z });
    // Damage falls off with distance; the thrower is not exempt.
    const victims = [];
    if (player.state.alive) victims.push({ pos: player.state.position, kind: 'player' });
    for (const bot of bots.list) if (bot.alive) victims.push({ pos: bot.group.position, kind: 'bot', bot });
    for (const v of victims) {
      const d = Math.hypot(v.pos.x - pos.x, v.pos.z - pos.z);
      if (d < GRENADE_RADIUS) {
        const damage = GRENADE_DAMAGE * (1 - d / GRENADE_RADIUS) + 15;
        if (v.kind === 'player') damagePlayer(damage, pos, 'a Spark grenade');
        else {
          const killed = damageBot(v.bot, damage, 'player');
          if (killed) {
            state.money += KILL_REWARD;
            state.playerKills += 1;
            killfeed('You', v.bot.name, false, 'sentinel');
            checkRoundEnd();
          }
        }
      }
    }
  }

  function plantCharge(byBot) {
    state.charge.planted = true;
    state.charge.timer = CHARGE_TIMER;
    state.charge.beep = 0;
    state.charge.plantedAt = state.time;
    const site = state.charge.site;
    chargeMesh.position.set(state.charge.x, 0.2, state.charge.z);
    chargeMesh.visible = true;
    chargeLight.position.set(state.charge.x, 1.2, state.charge.z);
    chargeLight.intensity = 6;
    audio.planted();
    // The blast kills anyone standing on the site, planter included — say
    // so plainly instead of telling the planter to defend it until it blows.
    emit({ type: 'banner', title: 'CHARGE PLANTED', sub: `${site} — fall back, it blows in ${CHARGE_TIMER}s`, tone: 'warn' });
    emit({ type: 'planted' });
  }

  function onPlanted(bot) {
    if (state.charge.planted) return;
    const site = bot.goalNode === 19 ? 'B' : 'A';
    state.charge.site = site;
    state.charge.x = site === 'A' ? SITES.A.x : SITES.B.x;
    state.charge.z = site === 'A' ? SITES.A.z : SITES.B.z;
    state.charge.carrier = null;
    bot.hasCharge = false;
    bot.actionProgress = 0;
    bot.state = 'advance';
    plantCharge(bot);
  }

  function onDefused(bot) {
    if (!state.charge.planted) return;
    state.charge.planted = false;
    chargeMesh.visible = false;
    chargeLight.intensity = 0;
    bot.actionProgress = 0;
    bot.state = 'advance';
    audio.roundLose();
    endRound('reaver', 'Charge defused');
  }

  function endRound(winner, reason) {
    if (state.phase === 'roundOver' || state.phase === 'matchOver') return;
    state.phase = 'roundOver';
    state.phaseTime = 0;
    state.score[winner] += 1;
    const playerWon = winner === 'sentinel';
    state.money += playerWon ? WIN_REWARD : LOSS_REWARD;
    emit({ type: 'banner', title: playerWon ? 'ROUND WON' : 'ROUND LOST', sub: reason, tone: playerWon ? 'good' : 'bad' });
    if (playerWon) audio.roundWin();
    else audio.roundLose();
    if (state.score[winner] >= WIN_ROUNDS) {
      state.phase = 'matchOver';
      emit({ type: 'match', winner, score: { ...state.score } });
    }
  }

  function checkRoundEnd() {
    if (state.phase !== 'live') return;
    const reavers = bots.aliveCount('reaver');
    const sentinels = bots.aliveCount('sentinel') + (player.state.alive ? 1 : 0);
    if (reavers === 0) {
      endRound('sentinel', state.charge.planted ? 'Site cleared' : 'Enemy team eliminated');
      return;
    }
    if (sentinels === 0 && !state.charge.planted) {
      endRound('reaver', 'Your team was eliminated');
    }
  }

  function startRound() {
    state.roundTime = ROUND_TIME;
    state.buyTime = BUY_TIME;
    state.phase = 'buy';
    state.phaseTime = 0;
    state.plantProgress = 0;
    state.blackout = { active: false, timer: 0, nextStrike: 16 + rng() * 10, flickerDone: false };
    state.flash = 0;
    state.graceUntil = 0;
    state.graceDone = false;
    state.charge = { carrier: 'player', planted: false, x: 0, z: 0, site: null, timer: CHARGE_TIMER, beep: 0 };
    botEnv.charge = state.charge; // startRound replaces the object; the bots must see the new one
    chargeMesh.visible = false;
    chargeLight.intensity = 0;
    player.state.alive = true;
    player.state.health = 100;
    player.state.position.set(SPAWNS.sentinel[1][0], 0, SPAWNS.sentinel[1][1]);
    player.state.velocity.set(0, 0, 0);
    player.state.yaw = 0;
    player.state.pitch = 0;
    weapon.refill();
    bots.spawnAll();
    // One teammate starts as the charge carrier's backup; the player carries it.
    bots.list[0].hasCharge = false;
    for (const bot of bots.list) bots.pickObjective(bot, botEnv);
    emit({ type: 'round', round: state.round });
    emit({ type: 'ammo' });
  }

  function buy(id) {
    if (state.phase !== 'buy') return false;
    if (id === 'grenade') {
      if (weapon.state.grenades >= 2 || state.money < GRENADE_PRICE) { audio.deny(); return false; }
      state.money -= GRENADE_PRICE;
      weapon.state.grenades += 1;
      audio.buy();
      emit({ type: 'ammo' });
      return true;
    }
    const def = WEAPONS[id];
    if (!def || state.money < def.price) { audio.deny(); return false; }
    // Re-buying the equipped gun used to charge full price for ammo the
    // next round refills free. Now it is a no-op: you already own it.
    if (def.id === weapon.state.def.id) { audio.deny(); return false; }
    state.money -= def.price;
    weapon.equip(def);
    audio.buy();
    emit({ type: 'ammo' });
    return true;
  }

  // Environment handed to the bots each step. Enemy targets are preallocated
  // objects mutated in place — enemiesOf allocates nothing per scan.
  const playerTarget = { kind: 'player', x: 0, y: 0, z: 0 };
  const botEnv = {
    time: 0,
    charge: state.charge,
    graceUntil: 0,
    los,
    enemiesOf(bot, out) {
      // Fills the caller's scratch array instead of allocating per scan.
      out.length = 0;
      if (bot.team === 'reaver') {
        if (player.state.alive) {
          playerTarget.x = player.state.position.x;
          playerTarget.y = player.state.position.y + player.state.eye;
          playerTarget.z = player.state.position.z;
          out.push(playerTarget);
        }
        for (const other of bots.list) {
          if (other.alive && other.team === 'sentinel') {
            if (!other._target) other._target = { kind: 'bot', bot: other, x: 0, y: 0, z: 0 };
            other._target.x = other.group.position.x;
            other._target.y = 1.35;
            other._target.z = other.group.position.z;
            out.push(other._target);
          }
        }
      } else {
        for (const other of bots.list) {
          if (other.alive && other.team === 'reaver') {
            if (!other._target) other._target = { kind: 'bot', bot: other, x: 0, y: 0, z: 0 };
            other._target.x = other.group.position.x;
            other._target.y = 1.35;
            other._target.z = other.group.position.z;
            out.push(other._target);
          }
        }
      }
      return out;
    },
    botShoot,
    defuseBeep() { audio.defuseBeep(); },
    onPlanted,
    onDefused,
    onCallout(text, team) {
      emit({ type: 'killfeed', text, team });
    },
  };

  // Lightning: a strike flashes the sky, then the street lights cut out for
  // a few seconds. The flash value decays in the render loop's light rig.
  function updateLightning(dt) {
    const blackout = state.blackout;
    state.flash = Math.max(0, state.flash - dt * 2.2);
    if (blackout.active) {
      blackout.timer -= dt;
      if (!blackout.flickerDone && blackout.timer < 3.4) {
        blackout.flickerDone = true;
        state.flash = 0.6; // second flicker as the lights die
      }
      if (blackout.timer <= 0) {
        blackout.active = false;
        blackout.nextStrike = 22 + rng() * 14;
        emit({ type: 'killfeed', text: 'Street lights are back on', team: 'sentinel' });
      }
      return;
    }
    blackout.nextStrike -= dt;
    if (blackout.nextStrike <= 0) {
      blackout.active = true;
      blackout.timer = 4;
      blackout.flickerDone = false;
      state.flash = 1;
      audio.thunder();
      emit({ type: 'banner', title: 'LIGHTNING — BLACKOUT', sub: 'Street lights out. Muzzle flashes are the light now.', tone: 'warn' });
      emit({ type: 'killfeed', text: '⚡ Lightning strike — blackout!', team: 'reaver' });
    }
  }

  function step(dt, keys) {
    state.time += dt;
    botEnv.time = state.time;
    state.shake = Math.max(0, state.shake - dt * 2.2);
    for (const t of tracers) {
      if (t.life > 0) {
        t.life -= dt;
        t.mesh.material.opacity = Math.max(0, t.life / 0.09) * 0.9;
        if (t.life <= 0) t.mesh.visible = false;
      }
    }
    if (boomLife > 0) {
      boomLife -= dt;
      const k = 1 - boomLife / 0.5;
      boom.scale.setScalar(1 + k * 9);
      boom.material.opacity = Math.max(0, 0.85 * (1 - k));
      boomLight.intensity = Math.max(0, 60 * (1 - k));
      if (boomLife <= 0) boom.visible = false;
    }

    // Grenade physics: gravity, bounce off colliders, fuse.
    for (const g of grenades) {
      if (!g.active) continue;
      g.fuse -= dt;
      g.vel.y -= 14 * dt;
      const next = _from.copy(g.pos).addScaledVector(g.vel, dt);
      let blocked = false;
      for (const c of world.colliders) {
        if (next.x > c.min.x - 0.09 && next.x < c.max.x + 0.09 && next.y > c.min.y - 0.09 && next.y < c.max.y + 0.09 && next.z > c.min.z - 0.09 && next.z < c.max.z + 0.09) {
          blocked = true;
          break;
        }
      }
      if (blocked) {
        g.vel.multiplyScalar(-0.35);
        g.vel.y = Math.abs(g.vel.y) * 0.4 + 1;
      } else {
        g.pos.copy(next);
        if (g.pos.y < 0.09) {
          g.pos.y = 0.09;
          g.vel.y = Math.abs(g.vel.y) * 0.4;
          g.vel.x *= 0.7;
          g.vel.z *= 0.7;
        }
      }
      g.mesh.position.copy(g.pos);
      if (g.fuse <= 0) {
        g.active = false;
        g.mesh.visible = false;
        explode(g.pos);
      }
    }

    if (state.phase === 'buy') {
      state.phaseTime += dt;
      state.buyTime -= dt;
      if (state.buyTime <= 0) {
        state.phase = 'live';
        state.phaseTime = 0;
        state.liveStart = state.time;
        emit({ type: 'banner', title: `ROUND ${state.round}`, sub: 'Plant the charge at Site A or Site B', tone: 'info' });
      }
      return;
    }
    if (state.phase === 'roundOver') {
      state.phaseTime += dt;
      if (state.phaseTime > 4 && state.score.sentinel < WIN_ROUNDS && state.score.reaver < WIN_ROUNDS) {
        state.round += 1;
        startRound();
      }
      return;
    }
    if (state.phase !== 'live') return;

    state.roundTime -= dt;
    if (state.roundTime <= 0) {
      state.roundTime = 0;
      if (!state.charge.planted) endRound('reaver', 'Time expired — charge never planted');
      return;
    }

    updateLightning(dt);

    // Last-man-standing grace: the moment the player becomes the only
    // living sentinel, reavers hold for 5 s instead of instantly
    // converging — once per round, with a callout so it reads as a rule.
    if (player.state.alive && bots.aliveCount('sentinel') === 0 && !state.graceDone) {
      state.graceDone = true;
      state.graceUntil = state.time + 5;
      emit({ type: 'killfeed', text: 'Last one standing — hold your ground!', team: 'sentinel' });
    }
    botEnv.graceUntil = state.graceUntil;

    // Player planting: hold E inside a site while carrying the charge.
    if (state.charge.carrier === 'player' && player.state.alive) {
      let inSite = null;
      for (const [key, site] of Object.entries(SITES)) {
        const d = Math.hypot(player.state.position.x - site.x, player.state.position.z - site.z);
        if (d < site.radius) inSite = key;
      }
      if (inSite && keys.has('KeyE')) {
        state.plantProgress += dt;
        if (Math.floor(state.plantProgress * 4) !== Math.floor((state.plantProgress - dt) * 4)) audio.plantBeep();
        if (state.plantProgress >= PLANT_TIME) {
          state.charge.site = inSite;
          state.charge.x = SITES[inSite].x;
          state.charge.z = SITES[inSite].z;
          state.charge.carrier = null;
          state.plantProgress = 0;
          plantCharge(null);
        }
      } else {
        state.plantProgress = 0;
      }
    }

    // Planted charge ticks down; beeps speed up as it nears zero.
    if (state.charge.planted) {
      state.charge.timer -= dt;
      state.charge.beep -= dt;
      const interval = state.charge.timer < 10 ? 0.5 : 1;
      if (state.charge.beep <= 0) {
        state.charge.beep = interval;
        audio.chargeTick();
        chargeLight.intensity = 6 + (state.charge.timer < 10 ? 4 : 0);
      }
      if (state.charge.timer <= 0) {
        state.charge.planted = false;
        chargeMesh.visible = false;
        chargeLight.intensity = 0;
        explode(_to.set(state.charge.x, 0.6, state.charge.z));
        endRound('sentinel', 'Charge detonated');
        return;
      }
    }

    bots.update(dt, botEnv);
    checkRoundEnd();
  }

  function resetMatch() {
    state.score = { sentinel: 0, reaver: 0 };
    state.round = 1;
    state.money = 1500;
    state.playerKills = 0;
    // Round 1 is a real choice, not a free rifle: the player starts on the
    // P9 with $1,500 — the Jol-9 or grenades now, the Megh-7 after a win.
    weapon.equip(WEAPONS.p9);
    startRound();
  }

  return {
    state,
    events,
    step,
    playerShoot,
    botShoot,
    throwGrenade,
    buy,
    startRound,
    resetMatch,
    endRound,
    checkRoundEnd,
    drainEvents() {
      const out = events.splice(0, events.length);
      return out;
    },
    los,
  };
}
