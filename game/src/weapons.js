// Weapons: four guns with distinct fire rates, damage, spread and feel, plus the
// Spark grenade. The module owns the numbers and the view model; sim.js owns
// the ray and the damage. Buying swaps the definition and the model.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9 Sidearm', kind: 'pistol', price: 0, auto: false,
    damage: 26, headMult: 3, mag: 12, reserve: 36, fireGap: 0.16,
    reloadTime: 1.4, spreadStill: 0.0035, spreadMove: 0.02, kick: 0.011, range: 60,
  },
  megh7: {
    id: 'megh7', name: 'Megh-7 Carbine', kind: 'rifle', price: 2700, auto: true,
    damage: 34, headMult: 3, mag: 30, reserve: 90, fireGap: 0.096,
    reloadTime: 1.9, spreadStill: 0.0022, spreadMove: 0.028, kick: 0.013, range: 80,
  },
  jol9: {
    id: 'jol9', name: 'Jol-9 SMG', kind: 'smg', price: 1500, auto: true,
    damage: 24, headMult: 3, mag: 32, reserve: 96, fireGap: 0.07,
    reloadTime: 1.6, spreadStill: 0.004, spreadMove: 0.03, kick: 0.008, range: 55,
  },
  bijli50: {
    id: 'bijli50', name: 'Bijli-50', kind: 'marksman', price: 4500, auto: false,
    damage: 95, headMult: 3, mag: 5, reserve: 15, fireGap: 1.1,
    reloadTime: 2.6, spreadStill: 0.0006, spreadMove: 0.05, kick: 0.05, range: 120,
  },
};
export const GRENADE_PRICE = 300;
export const GRENADE_FUSE = 1.6;
export const GRENADE_RADIUS = 7;
export const GRENADE_DAMAGE = 110;

const MUZZLE_TIME = 0.06;
const BLOOM_PER_SHOT = 0.0045;
const BLOOM_DECAY = 0.09;

// A slim two-tone view model built from the weapon's kind: long barrel for
// the marksman, short and stubby for the SMG. Rebuilt on buy, never during
// a frame. Slim receiver + grip + magazine so it reads as a gun, not a plank.
function buildModel(def) {
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.65, metalness: 0.25 });
  const metal = new THREE.MeshStandardMaterial({ color: new THREE.Color('#454d59'), roughness: 0.45, metalness: 0.45 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.2 });
  const model = new THREE.Group();
  const barrelLen = def.kind === 'marksman' ? 0.62 : def.kind === 'smg' ? 0.22 : def.kind === 'pistol' ? 0.16 : 0.4;
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 0.36), metal);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, barrelLen), dark);
  barrel.position.set(0, 0.02, -0.18 - barrelLen / 2);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.2), dark);
  stock.position.set(0, -0.015, 0.27);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.11, 0.06), dark);
  grip.position.set(0, -0.09, 0.08);
  grip.rotation.x = 0.35;
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.1, 0.07), dark);
  mag.position.set(0, -0.08, -0.08);
  mag.rotation.x = -0.12;
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.035, 0.05), accent);
  sight.position.set(0, 0.058, -0.05);
  model.add(receiver, barrel, stock, grip, mag, sight);
  model.userData.muzzleZ = -0.18 - barrelLen;
  // Canted slightly, like a held rifle, so the view model reads as a gun
  // instead of a plank.
  model.rotation.y = 0.18;
  model.rotation.z = -0.05;
  return model;
}

export function createWeapon(camera) {
  const modelHolder = new THREE.Group();
  camera.add(modelHolder);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.2, 0.2),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  // At the muzzle tip, not the middle of the screen: the old 0.34 plane at
  // z=-1.0 read as a giant orange diamond covering the target. Small, at
  // the gun, slightly tilted — a burst, not a billboard.
  flash.position.set(0.26, -0.22, -0.8);
  flash.rotation.z = 0.5;
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 6);
  flashLight.position.set(0.26, -0.2, -0.7);
  camera.add(flashLight);

  let model = null;
  const state = {
    def: WEAPONS.p9, mag: WEAPONS.p9.mag, reserve: WEAPONS.p9.reserve,
    cooldown: 0, reloadLeft: 0, flash: 0, kick: 0, bloom: 0,
    grenades: 0,
    primary: WEAPONS.p9, // the bought gun; the P9 is a permanent secondary
    ammoById: {}, // per-weapon mag/reserve, so switching keeps each gun's ammo
    adsT: 0, // 0 hipfire → 1 aimed: the view model rises toward centre
    adsTarget: false,
  };

  function equip(def) {
    // Stash the outgoing gun's ammo before swapping the model.
    if (state.def) state.ammoById[state.def.id] = { mag: state.mag, reserve: state.reserve };
    if (def.kind !== 'pistol') state.primary = def;
    if (model) {
      modelHolder.remove(model);
      model.traverse((child) => {
        if (child.isMesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
          else child.material.dispose();
        }
      });
    }
    state.def = def;
    const saved = state.ammoById[def.id];
    state.mag = saved ? saved.mag : def.mag;
    state.reserve = saved ? saved.reserve : def.reserve;
    state.cooldown = 0;
    state.reloadLeft = 0;
    state.flash = 0;
    state.kick = 0;
    state.bloom = 0;
    model = buildModel(def);
    model.position.set(0.26, -0.26, -0.5);
    model.scale.setScalar(0.68);
    modelHolder.add(model);
  }
  equip(WEAPONS.p9);

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.bloom = Math.max(0, state.bloom - BLOOM_DECAY * dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    state.adsT += ((state.adsTarget ? 1 : 0) - state.adsT) * Math.min(1, dt * 12);
    if (model) {
      // Aiming raises the gun toward the centre of the screen.
      model.position.x = 0.26 - state.adsT * 0.13;
      model.position.y = -0.26 + state.adsT * 0.09;
      model.position.z = -0.5 + state.kick;
      model.rotation.x = state.kick * 2.2;
      if (state.reloadLeft > 0) {
        model.rotation.x = -0.55 * Math.min(1, (state.def.reloadTime - state.reloadLeft) * 2);
      }
    }
    flash.visible = state.flash > 0;
    flashLight.intensity = state.flash > 0 ? 26 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      if (state.reloadLeft === 0) {
        const need = state.def.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
  }

  return {
    state,
    step,
    equip,
    // The end-of-round capture hides the view model so it never covers a
    // teammate in the frame; normal play always shows it.
    setModelVisible(v) { modelHolder.visible = v; },
    // Q / scroll swaps between the bought gun and the permanent P9 sidearm.
    toggleSecondary() {
      equip(state.def.id === 'p9' ? state.primary : WEAPONS.p9);
    },
    setAds(aiming) { state.adsTarget = aiming; },
    muzzleWorld(out) {
      // World position of the barrel tip, for tracers.
      if (!model) return camera.getWorldPosition(out);
      out.set(0.26, -0.24, -0.5 + 0.68 * model.userData.muzzleZ + state.kick);
      return camera.localToWorld(out);
    },
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = state.def.fireGap;
      state.flash = MUZZLE_TIME;
      state.kick = 0.05;
      state.bloom = Math.min(0.05, state.bloom + BLOOM_PER_SHOT);
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      if (state.reloadLeft > 0 || state.mag === state.def.mag || state.reserve === 0) return false;
      state.reloadLeft = state.def.reloadTime;
      return true;
    },
    spread(speed, crouching, aiming, ads = false) {
      const move = Math.min(1, speed / 5.4);
      let spread = state.def.spreadStill + move * state.def.spreadMove + state.bloom;
      if (crouching) spread *= 0.7;
      if (aiming) spread *= 0.6;
      if (ads) spread *= 0.7; // right-mouse ADS tightens further
      return spread;
    },
    refill() {
      state.ammoById = {};
      equip(state.def);
      state.grenades = 0;
    },
  };
}
