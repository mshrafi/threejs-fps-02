// Bots: 5v5 teammates and enemies on a waypoint graph. Each bot picks a route
// to its objective, advances, holds angles at waypoints, peeks, investigates
// gunfire it hears, takes cover when hurt, and plants or defuses the charge.
// Shooting is a burst model with line-of-sight checks and accuracy that is
// worse while moving and better while holding an angle.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const BOT_SPEED = 3.6;
const BOT_HOLD_SPEED = 1.6;
const SIGHT_RANGE = 42;
const SCAN_EVERY = 0.15;
const HEAR_RANGE = 26;

const SENTINEL_NAMES = ['Arif', 'Tanvir', 'Nayeem', 'Shakib'];
const REAVER_NAMES = ['Rook', 'Sable', 'Jinx', 'Dagger', 'Hex'];

function nearestWaypoint(waypoints, x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < waypoints.length; i += 1) {
    const dx = waypoints[i][0] - x;
    const dz = waypoints[i][1] - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// Breadth-first path over the waypoint graph; returns waypoint ids from start
// (exclusive) to goal (inclusive). Reuses scratch arrays, no allocation per call.
function findPath(adjacency, start, goal, out) {
  out.length = 0;
  if (start === goal) return out;
  const prev = new Int16Array(adjacency.length).fill(-1);
  const queue = [start];
  prev[start] = start;
  let head = 0;
  while (head < queue.length) {
    const node = queue[head];
    head += 1;
    if (node === goal) break;
    for (const next of adjacency[node]) {
      if (prev[next] === -1) {
        prev[next] = node;
        queue.push(next);
      }
    }
  }
  if (prev[goal] === -1) return out;
  let node = goal;
  const reversed = [];
  while (node !== start) {
    reversed.push(node);
    node = prev[node];
  }
  for (let i = reversed.length - 1; i >= 0; i -= 1) out.push(reversed[i]);
  return out;
}

function buildBotMesh(team) {
  const color = team === 'sentinel' ? PALETTE.sentinel : PALETTE.reaver;
  const group = new THREE.Group();
  const torsoMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.7, metalness: 0.1 });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#20242b'), roughness: 0.9 });
  const visorMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.3, metalness: 0.4 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), torsoMat);
  torso.position.y = 1.05;
  torso.castShadow = true;
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.72, 0.28), darkMat);
  legs.position.y = 0.36;
  legs.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10), darkMat);
  head.position.y = 1.56;
  head.castShadow = true;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.07, 0.05), visorMat);
  visor.position.set(0, 1.58, 0.19);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.62), darkMat);
  gun.position.set(0.24, 1.12, -0.2);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.32, 0.42, 20),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  group.add(torso, legs, head, visor, gun, ring);
  return { group, head, torso };
}

export function createBots(scene, world, rng) {
  const { waypoints, adjacency, colliders } = world;
  const list = [];
  const probe = new THREE.Box3();
  const pathScratch = [];
  const eyeFrom = new THREE.Vector3();
  // One flank callout per round: the first flanker to move announces it,
  // the others just go.
  let flankCalloutDone = false;

  function makeBot(team, index, x, z) {
    const { group, head, torso } = buildBotMesh(team);
    group.position.set(x, 0, z);
    scene.add(group);
    const bot = {
      id: `${team}-${index}`,
      name: team === 'sentinel' ? SENTINEL_NAMES[index] : REAVER_NAMES[index],
      team,
      group,
      headMesh: head,
      torsoMesh: torso,
      yaw: team === 'sentinel' ? Math.PI : 0,
      health: 100,
      alive: true,
      state: 'advance',
      stateTime: 0,
      scanTimer: rng() * SCAN_EVERY,
      path: [],
      pathIndex: 0,
      goalNode: -1,
      holdLeft: 0,
      shootTimer: 0,
      burstLeft: 0,
      burstPause: 0,
      target: null, // 'player' or a bot
      lastHeard: null,
      lastHeardTime: -99,
      hasCharge: false,
      actionProgress: 0, // plant / defuse progress in seconds
      speed: BOT_SPEED,
      moving: false,
      strafeDir: 1,
      strafeTimer: 0,
      reaction: 0.35 + rng() * 0.45,
      // Roles make bots behave differently from each other: 'flanker' bots
      // take the long lane around the far side, 'regrouper' falls back to
      // heal when hurt instead of fighting to the death.
      role: 'standard',
      flankStage: 0,
      flankAnnounced: false,
    };
    head.userData = { bot, part: 'head' };
    torso.userData = { bot, part: 'body' };
    list.push(bot);
    return bot;
  }

  function spawnAll() {
    for (const bot of list) scene.remove(bot.group);
    list.length = 0;
    flankCalloutDone = false;
    for (let i = 0; i < 4; i += 1) {
      const [x, z] = [[-4, 15.5], [0, 15.5], [4, 15.5], [-7, 14]][i];
      makeBot('sentinel', i, x, z);
    }
    for (let i = 0; i < 5; i += 1) {
      const [x, z] = [[-4, -15.5], [0, -15.5], [4, -15.5], [-7, -14], [7, -14]][i];
      makeBot('reaver', i, x, z);
    }
    // Distinct roles: two Reavers flank down the long lanes, one Reaver is
    // the regrouper who falls back to heal, and one Sentinel flanks too.
    list[5].role = 'flanker';
    list[6].role = 'flanker';
    list[7].role = 'regrouper';
    list[1].role = 'flanker';
    return list;
  }

  function setPath(bot, goalNode) {
    const start = nearestWaypoint(waypoints, bot.group.position.x, bot.group.position.z);
    bot.path = findPath(adjacency, start, goalNode, pathScratch.slice());
    bot.pathIndex = 0;
    bot.goalNode = goalNode;
  }

  function overlapsBot(x, z) {
    probe.min.set(x - 0.34, 0.04, z - 0.34);
    probe.max.set(x + 0.34, 1.7, z + 0.34);
    for (const collider of colliders) if (probe.intersectsBox(collider)) return true;
    return false;
  }

  function moveToward(bot, tx, tz, dt, speed) {
    const dx = tx - bot.group.position.x;
    const dz = tz - bot.group.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.05) return true;
    const stepLen = Math.min(dist, speed * dt);
    const nx = bot.group.position.x + (dx / dist) * stepLen;
    const nz = bot.group.position.z + (dz / dist) * stepLen;
    // Axis-separated so a bot slides along a wall instead of sticking to it.
    if (!overlapsBot(nx, bot.group.position.z)) bot.group.position.x = nx;
    if (!overlapsBot(bot.group.position.x, nz)) bot.group.position.z = nz;
    bot.group.position.x = Math.max(-23.4, Math.min(23.4, bot.group.position.x));
    bot.group.position.z = Math.max(-17.4, Math.min(17.4, bot.group.position.z));
    bot.yaw = Math.atan2(-dx, -dz);
    bot.moving = true;
    return dist <= 0.6;
  }

  function pickObjective(bot, env) {
    // Sentinels push a site; Reavers hold the sites and rotate between them.
    // Flankers take the long way round instead: A-long or the B-tunnels,
    // and the kill feed calls it out so the player can react.
    if (bot.role === 'flanker') {
      const lane = rng() < 0.5 ? 6 : 18; // A-long end / B-tunnels end
      const site = lane === 6 ? 7 : 19;
      setPath(bot, lane);
      bot.flankStage = 0;
      bot.goalNode = site;
      if (!bot.flankAnnounced && !flankCalloutDone && env.onCallout) {
        bot.flankAnnounced = true;
        flankCalloutDone = true;
        env.onCallout(`${bot.name} flanking ${lane === 6 ? 'A' : 'B'}!`, bot.team);
      }
      bot.state = 'advance';
      bot.stateTime = 0;
      return;
    }
    if (bot.team === 'sentinel') {
      const site = bot.hasCharge ? (rng() < 0.5 ? 7 : 19) : (bot.id.endsWith('0') || bot.id.endsWith('2') ? 7 : 19);
      setPath(bot, site);
    } else {
      setPath(bot, rng() < 0.5 ? 8 : 20);
    }
    bot.state = 'advance';
    bot.stateTime = 0;
  }

  function updateBot(bot, dt, env) {
    if (!bot.alive) return;
    bot.stateTime += dt;
    bot.scanTimer -= dt;
    bot.strafeTimer -= dt;

    // Periodic perception: nearest visible enemy decides the fight.
    if (bot.scanTimer <= 0) {
      bot.scanTimer = SCAN_EVERY;
      let best = null;
      let bestD = Infinity;
      const candidates = env.enemiesOf(bot);
      for (const enemy of candidates) {
        const dx = enemy.x - bot.group.position.x;
        const dz = enemy.z - bot.group.position.z;
        const d = Math.hypot(dx, dz);
        // Sight is eye-to-eye: the ray starts at the bot's eye height, not
        // the ground, or low cover would blind every bot.
        eyeFrom.set(bot.group.position.x, 1.35, bot.group.position.z);
        if (d < SIGHT_RANGE && d < bestD && env.los(eyeFrom, enemy)) {
          best = enemy;
          bestD = d;
        }
      }
      if (best) {
        bot.target = best;
        if (bot.state !== 'engage' && bot.state !== 'defuse' && bot.state !== 'plant') {
          bot.state = 'engage';
          bot.stateTime = 0;
          bot.shootTimer = bot.reaction;
          bot.burstLeft = 0;
        }
      } else if (bot.state === 'engage') {
        bot.target = null;
        bot.state = 'advance';
        bot.stateTime = 0;
        if (bot.pathIndex >= bot.path.length) pickObjective(bot, env);
      }
    }

    // The regrouper falls back to heal when hurt, then rejoins the fight.
    if (bot.role === 'regrouper' && bot.health < 40 && bot.state !== 'regroup') {
      bot.state = 'regroup';
      bot.target = null;
      setPath(bot, bot.team === 'sentinel' ? 0 : 21);
      if (env.onCallout) env.onCallout(`${bot.name} falling back to regroup!`, bot.team);
    }

    // Heard a shot recently and nothing to fight: go look.
    if (bot.state !== 'engage' && bot.lastHeard && env.time - bot.lastHeardTime < 6) {
      const dx = bot.lastHeard.x - bot.group.position.x;
      const dz = bot.lastHeard.z - bot.group.position.z;
      if (Math.hypot(dx, dz) > 3) {
        const node = nearestWaypoint(waypoints, bot.lastHeard.x, bot.lastHeard.z);
        if (node !== bot.goalNode) {
          setPath(bot, node);
          bot.state = 'advance';
        }
      }
    }

    // Plant / defuse duties outrank patrolling — and once a bot is standing
    // on the charge or the site, finishing the job outranks a distant fight.
    if (env.charge.planted) {
      if (bot.team === 'reaver') {
        const dx = env.charge.x - bot.group.position.x;
        const dz = env.charge.z - bot.group.position.z;
        if (Math.hypot(dx, dz) < 2.6) {
          bot.state = 'defuse';
          bot.target = null;
          bot.actionProgress += dt;
          bot.moving = false;
          if (bot.actionProgress >= 4) env.onDefused(bot);
          return;
        }
        if (bot.state !== 'defuse' && bot.state !== 'engage') {
          const node = nearestWaypoint(waypoints, env.charge.x, env.charge.z);
          if (node !== bot.goalNode) setPath(bot, node);
        }
      }
    } else if (bot.hasCharge) {
      const site = bot.goalNode === 19 ? { x: 17, z: -9 } : { x: -17, z: -9 };
      const dx = site.x - bot.group.position.x;
      const dz = site.z - bot.group.position.z;
      if (Math.hypot(dx, dz) < 3) {
        bot.state = 'plant';
        bot.target = null;
        bot.actionProgress += dt;
        bot.moving = false;
        if (bot.actionProgress >= 3) env.onPlanted(bot);
        return;
      }
    }

    bot.moving = false;
    if (bot.state === 'regroup') {
      // Fallen back: walk to the rear, then heal in place until fit again.
      if (bot.pathIndex >= bot.path.length) {
        bot.health = Math.min(75, bot.health + 6 * dt);
        if (bot.health >= 75) {
          bot.state = 'advance';
          pickObjective(bot, env);
        }
      } else {
        const node = waypoints[bot.path[bot.pathIndex]];
        if (moveToward(bot, node[0], node[1], dt, bot.speed)) bot.pathIndex += 1;
      }
    } else if (bot.state === 'engage' && bot.target) {
      // Face the target, strafe between bursts, fire in bursts of 3-5.
      const tx = bot.target.x;
      const tz = bot.target.z;
      bot.yaw = Math.atan2(-(tx - bot.group.position.x), -(tz - bot.group.position.z));
      if (bot.strafeTimer <= 0) {
        bot.strafeDir = rng() < 0.5 ? -1 : 1;
        bot.strafeTimer = 0.7 + rng() * 0.8;
      }
      bot.shootTimer -= dt;
      if (bot.burstLeft > 0 && bot.shootTimer <= 0) {
        bot.shootTimer = 0.13;
        bot.burstLeft -= 1;
        env.botShoot(bot, bot.target);
        if (bot.burstLeft === 0) bot.burstPause = 0.8 + rng() * 0.7;
      } else if (bot.burstLeft === 0) {
        bot.burstPause -= dt;
        if (bot.burstPause <= 0) bot.burstLeft = 3 + Math.floor(rng() * 3);
      }
      // Strafe sideways while fighting, but hold still during a burst.
      if (bot.burstLeft === 0) {
        const sx = Math.cos(bot.yaw) * bot.strafeDir;
        const sz = -Math.sin(bot.yaw) * bot.strafeDir;
        moveToward(bot, bot.group.position.x + sx, bot.group.position.z + sz, dt, BOT_HOLD_SPEED);
      }
    } else if (bot.state === 'hold') {
      bot.holdLeft -= dt;
      bot.yaw += Math.sin(env.time * 0.6 + bot.id.charCodeAt(bot.id.length - 1)) * dt * 0.25;
      if (bot.holdLeft <= 0) {
        bot.state = 'advance';
        bot.stateTime = 0;
      }
    } else {
      // advance: walk the path, pausing at waypoints to hold an angle.
      if (bot.pathIndex >= bot.path.length) {
        // A flanker who reached the lane end carries on to the site itself.
        if (bot.role === 'flanker' && bot.flankStage === 0) {
          setPath(bot, bot.goalNode);
          bot.flankStage = 1;
          bot.state = 'advance';
        } else if (bot.state !== 'hold') {
          bot.state = 'hold';
          bot.holdLeft = 0.9 + rng() * 1.6;
          bot.stateTime = 0;
        }
      } else {
        const node = waypoints[bot.path[bot.pathIndex]];
        if (moveToward(bot, node[0], node[1], dt, bot.speed)) {
          bot.pathIndex += 1;
          if (bot.pathIndex >= bot.path.length && rng() < 0.5) {
            bot.state = 'hold';
            bot.holdLeft = 0.9 + rng() * 1.4;
          }
        }
      }
    }

    bot.group.rotation.y = bot.yaw;
    // Walk bob: legs swing is faked by a small torso sway.
    bot.torsoMesh.rotation.z = bot.moving ? Math.sin(env.time * 9 + bot.id.length) * 0.06 : 0;
  }

  return {
    list,
    spawnAll,
    setPath,
    pickObjective,
    hearShot(pos, time) {
      for (const bot of list) {
        if (!bot.alive) continue;
        const dx = pos.x - bot.group.position.x;
        const dz = pos.z - bot.group.position.z;
        if (Math.hypot(dx, dz) < HEAR_RANGE) {
          bot.lastHeard = { x: pos.x, z: pos.z };
          bot.lastHeardTime = time;
        }
      }
    },
    update(dt, env) {
      for (const bot of list) updateBot(bot, dt, env);
      // Soft separation so bots never stand inside each other.
      for (let i = 0; i < list.length; i += 1) {
        const a = list[i];
        if (!a.alive) continue;
        for (let j = i + 1; j < list.length; j += 1) {
          const b = list[j];
          if (!b.alive) continue;
          const dx = b.group.position.x - a.group.position.x;
          const dz = b.group.position.z - a.group.position.z;
          const d = Math.hypot(dx, dz);
          if (d > 0.001 && d < 0.8) {
            const push = (0.8 - d) / 2;
            const nx = dx / d;
            const nz = dz / d;
            a.group.position.x -= nx * push;
            a.group.position.z -= nz * push;
            b.group.position.x += nx * push;
            b.group.position.z += nz * push;
          }
        }
      }
    },
    aliveCount(team) {
      let n = 0;
      for (const bot of list) if (bot.alive && bot.team === team) n += 1;
      return n;
    },
    reset() {
      for (const bot of list) {
        bot.health = 100;
        bot.alive = true;
        bot.group.visible = true;
        bot.state = 'advance';
        bot.stateTime = 0;
        bot.path = [];
        bot.pathIndex = 0;
        bot.target = null;
        bot.lastHeard = null;
        bot.actionProgress = 0;
        bot.hasCharge = false;
        bot.burstLeft = 0;
        bot.flankAnnounced = false;
        bot.flankStage = 0;
      }
    },
  };
}
