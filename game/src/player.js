// Player movement: acceleration, friction, gravity, crouch and jump, resolved
// as a box against the world's colliders one axis at a time, so a wall never
// swallows the player. Shift walks slow (aim), Ctrl/C crouches, Space jumps.
import * as THREE from 'three';

const RADIUS = 0.34;
const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
// Rain-slick streets: lower friction and gentler acceleration than dry
// ground, so the player slides a little further before stopping — the wet
// asphalt changes how movement feels, not just how it looks.
const WALK_SPEED = 5.4;
const AIM_SPEED = 2.8;
const CROUCH_SPEED = 2.5;
const GROUND_ACCEL = 30;
const AIR_ACCEL = 10;
const FRICTION = 5.5;
const GRAVITY = 21;
const JUMP_SPEED = 6.4;

export function createPlayer(colliders) {
  const state = {
    position: new THREE.Vector3(0, 0, 15.5),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    eye: STAND_EYE,
    onGround: true,
    crouching: false,
    aiming: false,
    height: STAND_HEIGHT,
    alive: true,
    health: 100,
  };
  const probe = new THREE.Box3();
  const wish = new THREE.Vector3();

  function overlaps(x, y, z, height, lift) {
    probe.min.set(x - RADIUS, y + lift, z - RADIUS);
    probe.max.set(x + RADIUS, y + height - lift, z + RADIUS);
    for (const collider of colliders) if (probe.intersectsBox(collider)) return collider;
    return null;
  }

  function look(dx, dy, sensitivity = 0.0022) {
    state.yaw -= dx * sensitivity;
    state.pitch = Math.max(-1.45, Math.min(1.45, state.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    state.pitch = Math.min(1.45, state.pitch + pitchKick);
    state.yaw += yawKick;
  }

  function step(dt, keys) {
    if (!state.alive) return;
    const crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    state.aiming = keys.has('ShiftLeft') || keys.has('ShiftRight');
    if (crouching && !state.crouching) {
      state.crouching = true;
      state.height = CROUCH_HEIGHT;
    } else if (!crouching && state.crouching && !overlaps(state.position.x, state.position.y, state.position.z, STAND_HEIGHT, 0.02)) {
      state.crouching = false;
      state.height = STAND_HEIGHT;
    }
    const eyeTarget = state.crouching ? CROUCH_EYE : STAND_EYE;
    state.eye += (eyeTarget - state.eye) * Math.min(1, dt * 12);

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    wish.set(0, 0, 0);
    if (forward || strafe) {
      const sin = Math.sin(state.yaw);
      const cos = Math.cos(state.yaw);
      wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe).normalize();
    }

    const speed = state.crouching ? CROUCH_SPEED : state.aiming ? AIM_SPEED : WALK_SPEED;
    const blend = Math.min(1, (state.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt / speed);
    state.velocity.x += (wish.x * speed - state.velocity.x) * blend;
    state.velocity.z += (wish.z * speed - state.velocity.z) * blend;
    if (state.onGround && !wish.lengthSq()) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      state.velocity.x *= damp;
      state.velocity.z *= damp;
    }

    if (keys.has('Space') && state.onGround) {
      state.velocity.y = JUMP_SPEED;
      state.onGround = false;
    }
    state.velocity.y -= GRAVITY * dt;

    const nextX = state.position.x + state.velocity.x * dt;
    if (!overlaps(nextX, state.position.y, state.position.z, state.height, 0.04)) state.position.x = nextX;
    else state.velocity.x = 0;
    const nextZ = state.position.z + state.velocity.z * dt;
    if (!overlaps(state.position.x, state.position.y, nextZ, state.height, 0.04)) state.position.z = nextZ;
    else state.velocity.z = 0;

    state.position.y += state.velocity.y * dt;
    state.onGround = false;
    const hit = overlaps(state.position.x, state.position.y, state.position.z, state.height, 0);
    if (hit && state.velocity.y <= 0) {
      state.position.y = hit.max.y;
      state.velocity.y = 0;
      state.onGround = true;
    } else if (hit) {
      state.position.y = hit.min.y - state.height;
      state.velocity.y = 0;
    }
    if (state.position.y < 0) {
      state.position.y = 0;
      state.velocity.y = 0;
      state.onGround = true;
    }
    state.velocity.y = Math.max(-30, state.velocity.y);
  }

  return {
    state,
    step,
    look,
    recoil,
    groundSpeed() {
      return Math.hypot(state.velocity.x, state.velocity.z);
    },
  };
}
