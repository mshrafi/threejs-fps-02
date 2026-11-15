// MONSOON STRIKE map: a rainy Dhaka night street, 48 x 36 m. The layout is a
// tactical three-lane map — A-long down the west wall, mid through the market
// yard, B-tunnels down the east side — dressed as a monsoon night city: wet
// reflective asphalt, puddles, neon shop signs with fictional names, rickshaw
// cover, street lamps, and a night sky that flashes with lightning.
// Two objective sites (A west, B east) are marked with neon pads and signs.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Waypoints: id -> [x, z]; edges are the lanes bots actually walk.
const WAYPOINTS = [
  [0, 15], [-4, 15], [4, 15], // 0-2 Barsha Guard spawn
  [-14, 14], [-20, 8], [-20, 0], [-20, -6], // 3-6 A-long (3 sits south of
  // the market-hall wall's end, so the lane turns the wall instead of
  // crossing it)
  [-17, -9], [-13, -9], // 7-8 Site A
  [-6, 8], [-4, 2], [0, 0], [4, -2], [6, -8], // 9-13 mid
  [0, -12], // 14 mid top
  [14, 13], [19, 8], [20, 0], [19, -6.5], // 15-18 B-tunnels (18 sits east
  // of the site-B sign pole so the lane does not clip it)
  [17, -9], [12, -9], // 19-20 Site B
  [0, -15], [-6, -15], [6, -15], // 21-23 Neon Reavers spawn
  [-12, -13], [12, -13], // 24-25 north connectors
  [-10, -6], [10, -4], // 26-27 site connectors
  [-14, -2.5], // 28 market-hall gap: the only opening in the x=-14 wall
  [15.5, -7.5], // 29 B-wall gap: the only opening between the two x=15.5 walls
  [14, -7.5], // 30 west of the B wall, so the gap exit never runs along it
];
const EDGES = [
  [0, 1], [0, 2], [1, 3], [2, 15], [0, 9], [2, 9],
  [3, 4], [4, 5], [5, 6], [6, 7], [8, 26],
  [9, 10], [10, 11], [11, 12], [12, 13], [13, 14], [14, 26], [14, 25],
  [15, 16], [16, 17], [17, 18], [18, 19], [20, 27],
  [8, 24], [20, 25], [24, 21], [25, 21], [21, 22], [21, 23],
  [22, 24], [23, 25], [24, 14], [25, 14], [11, 9], [11, 13],
  [10, 28], [28, 5], [17, 29], [29, 30], [30, 20],
];
// Every edge above is probe-verified: a bot walking the straight line
// between its waypoints (0.34 m probe) hits no collider. Edges that failed
// the probe were cut, because moveToward has no push-out and a bot whose
// probe touches a wall face while its target lies beyond it wedges there:
// 26-7 and 7-8 cross the x=-14 market-hall wall, 26-10 crosses the z=-4.5
// hall wall, 5-10 crosses the x=-14 wall, 19-20 and 19-27 cross the B
// wall at x=15.5, and 12/13/14-27 cross the mid container at (8,-6).
// Site A is reached through the gap waypoint 28 and down A-long
// (10-28-5-6-7); Site B is reached through the B-wall gap waypoint 29 and
// the B-tunnels (14-25-20-29-17-18-19).
// Node 27 is a spur off 20 since its mid approaches all cross the container.

export const SITES = {
  A: { name: 'Site A', x: -17, z: -9, radius: 4.2 },
  B: { name: 'Site B', x: 17, z: -9, radius: 4.2 },
};
export const SPAWNS = {
  sentinel: [[-4, 15.5], [0, 15.5], [4, 15.5], [-7, 14], [7, 14]],
  reaver: [[-4, -15.5], [0, -15.5], [4, -15.5], [-7, -14], [7, -14]],
};

// Neon shop signs: fictional Dhaka names, drawn once on a canvas and used as
// emissive textures, so the street glows without any image files.
const SIGNS = [
  ['CHAI GHAR', '#ff4d8d'], ['MEGH MOBILE', '#35d0ff'], ['NEON BIRYANI', '#f0a832'],
  ['JOL CAFE', '#59e39a'], ['BIJLI ELECTRONICS', '#35d0ff'], ['DHAKA DELIGHT', '#ff4d8d'],
  ['MONSOON TAILOR', '#f0a832'], ['RICKY TEA STALL', '#59e39a'],
];

function neonTexture(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  g.fillStyle = '#0d0f16';
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = color;
  g.lineWidth = 4;
  g.strokeRect(5, 5, 502, 118);
  g.fillStyle = color;
  g.shadowColor = color;
  g.shadowBlur = 22;
  g.font = 'bold 52px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 66);
  g.fillText(text, 256, 66);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function siteTexture(letter) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  g.fillStyle = '#0d0f16';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#f0a832';
  g.lineWidth = 6;
  g.strokeRect(6, 6, 116, 116);
  g.fillStyle = '#f0a832';
  g.shadowColor = '#f0a832';
  g.shadowBlur = 18;
  g.font = 'bold 84px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(letter, 64, 68);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: name === 'rust' || name.startsWith('container') ? 0.25 : 0.04,
    });
  }
  // Wet asphalt: low roughness and some metalness so lamps and neon smear
  // across the street instead of dying on it.
  const wetGround = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.groundWet), roughness: 0.32, metalness: 0.55,
  });
  const puddleMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#0e1c2a'), roughness: 0.05, metalness: 0.9,
  });
  const colliders = [];
  const shootables = [];

  function box(w, h, d, x, y, z, mat, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[mat]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  function barrel(x, z) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.42, 1.05, 12),
      materials.rust,
    );
    mesh.position.set(x, 0.53, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
  }

  // A rickshaw: canopy, seat and two wheels, built from boxes and cylinders.
  function rickshaw(x, z, rotY) {
    const r = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.neonPink), roughness: 0.5, metalness: 0.3 });
    const seatMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#20242b'), roughness: 0.9 });
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 0.9), paint);
    canopy.position.set(0, 1.5, 0.2);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.18, 0.7), seatMat);
    seat.position.set(0, 0.75, 0.2);
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.7, 0.1), paint);
    back.position.set(0, 1.1, 0.62);
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.1, 1.4), seatMat);
    base.position.set(0, 0.45, 0);
    r.add(canopy, seat, back, base);
    for (const side of [-0.55, 0.55]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 14), seatMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(side, 0.42, 0.1);
      r.add(wheel);
    }
    r.position.set(x, 0, z);
    r.rotation.y = rotY;
    r.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        shootables.push(child);
      }
    });
    group.add(r);
    colliders.push(new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(x, 0.8, z), new THREE.Vector3(1.3, 1.6, 1.6)));
    return r;
  }

  // Ground and perimeter walls (5 m, open to the night sky).
  const ground = new THREE.Mesh(new THREE.BoxGeometry(48.8, 0.4, 36.8), wetGround);
  ground.position.set(0, -0.2, 0);
  ground.receiveShadow = true;
  group.add(ground);
  shootables.push(ground);
  colliders.push(new THREE.Box3().setFromObject(ground));
  box(0.6, 5, 36.8, -24.3, 2.5, 0, 'hairline');
  box(0.6, 5, 36.8, 24.3, 2.5, 0, 'hairline');
  box(48.8, 5, 0.6, 0, 2.5, -18.3, 'hairline');
  box(48.8, 5, 0.6, 0, 2.5, 18.3, 'hairline');

  // Puddles: mirror-smooth discs that catch the neon and the lamps.
  for (const [x, z, r] of [[-8, 4, 2.2], [6, -3, 1.8], [-2, -10, 2.6], [14, 6, 2.0], [-16, 6, 1.6], [10, 12, 2.4]]) {
    const puddle = new THREE.Mesh(new THREE.CircleGeometry(r, 20), puddleMat);
    puddle.rotation.x = -Math.PI / 2;
    puddle.position.set(x, 0.02, z);
    puddle.receiveShadow = true;
    group.add(puddle);
  }

  // Site pads: neon floor plates with a lettered sign on a pole.
  for (const [key, site] of Object.entries(SITES)) {
    const pad = box(7, 0.12, 7, site.x, 0.06, site.z, 'accent', false);
    pad.material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE.accent), roughness: 0.4, metalness: 0.3,
      emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 0.45,
    });
    box(0.18, 3.4, 0.18, site.x + 3.2, 1.7, site.z + 3.2, 'hairline');
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 1.6),
      new THREE.MeshBasicMaterial({ map: siteTexture(key), side: THREE.DoubleSide }),
    );
    sign.position.set(site.x + 3.2, 3.6, site.z + 3.2);
    sign.rotation.y = Math.PI * 0.25;
    group.add(sign);
  }

  // Neon shop signs on the walls and the market stalls. Each entry is
  // [sign index, x, y, z, rotY]; planes face into the street by default.
  const signPlacements = [
    [0, 0, 3.4, -17.9, 0], // CHAI GHAR, north wall
    [1, 0, 3.4, 17.9, Math.PI], // MEGH MOBILE, south wall
    [2, -23.9, 3.4, 0, Math.PI / 2], // NEON BIRYANI, west wall
    [3, 23.9, 3.4, 0, -Math.PI / 2], // JOL CAFE, east wall
    [4, -13.7, 3.0, 6, Math.PI / 2], // BIJLI ELECTRONICS, market hall
    [5, -4, 2.4, -0.7, 0], // DHAKA DELIGHT, container face
    [6, 15.2, 3.0, 2, -Math.PI / 2], // MONSOON TAILOR, B-tunnel wall
    [7, 9, 2.4, 4.7, Math.PI], // RICKY TEA STALL, container face
  ];
  const signMeshes = [];
  for (const [index, x, y, z, rotY] of signPlacements) {
    const [name, color] = SIGNS[index];
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(4.4, 1.1),
      new THREE.MeshBasicMaterial({ map: neonTexture(name, color) }),
    );
    sign.position.set(x, y, z);
    sign.rotation.y = rotY;
    group.add(sign);
    signMeshes.push(sign);
  }

  // Market hall (north-west): two long walls forming the A-long approach.
  box(0.5, 3.4, 14, -14, 1.7, 6, 'surface');
  box(0.5, 3.4, 10, -14, 1.7, -9, 'surface');
  box(6, 3.4, 0.5, -11, 1.7, -4.5, 'surface');

  // Market yard (mid): stacked cargo containers make the mid lanes.
  box(6, 2.5, 2.5, -4, 1.25, -2, 'containerBlue');
  box(6, 2.5, 2.5, -4, 3.75, -2, 'containerRed');
  box(2.5, 2.5, 6, 3, 1.25, 3, 'containerGreen');
  box(2.5, 2.5, 6, 8, 1.25, -6, 'containerRed');
  box(6, 2.5, 2.5, 9, 1.25, 6, 'containerBlue');
  box(2.5, 2.5, 2.5, -9, 1.25, 4, 'containerGreen');

  // B-tunnels: roofed alley down the east side (roof at 3.2 m).
  box(0.5, 3.4, 16, 15.5, 1.7, 2, 'surface');
  box(9, 0.5, 16, 19.8, 3.4, 2, 'rust', false);
  box(0.5, 3.4, 6, 15.5, 1.7, -11, 'surface');
  box(2.5, 2.5, 2.5, 22, 1.25, -3, 'containerBlue');

  // Crates, market stalls and cover scattered on the lanes.
  const crates = [
    [-22, -1, 1.2], [-20, -11, 1.2], [-10, 10, 1.2], [10, 11, 1.2],
    [-6, -10, 1.2], [2, -9, 1.2], [-14.5, -13, 1.2], [13, -13, 1.2],
    [0, 7, 1.2], [-17, 2, 1.2], [14, -2, 1.2],
  ];
  for (const [x, z, s] of crates) box(s, s, s, x, s / 2, z, 'hairline');
  box(1.2, 1.2, 1.2, -22, 1.8, -1, 'hairline');
  box(1.2, 1.2, 1.2, 10, 1.8, 11, 'hairline');
  box(3.2, 1.1, 1.2, 2, 0.55, 11, 'hairline');
  box(3.2, 1.1, 1.2, -8, 0.55, -11, 'hairline');
  box(1.2, 1.1, 3.2, 8, 0.55, 10, 'hairline');

  // Rickshaws parked as alley cover, and water drums.
  rickshaw(-8, 9, 0.4);
  rickshaw(12, 1.5, -0.7);
  rickshaw(-18, -4, 1.2);
  barrel(-18, 4); barrel(-18.9, 4.6); barrel(12, 9); barrel(12.9, 9.5);
  barrel(-8, -3); barrel(16, 14); barrel(-22, -13); barrel(22, -13);

  // Pipes along the walls.
  const pipeMat = materials.rust;
  for (const [x, z, len, rotY] of [[-23.6, 0, 18, 0], [23.6, 0, 18, 0], [0, -17.6, 20, Math.PI / 2]]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, len, 10), pipeMat);
    pipe.rotation.z = Math.PI / 2;
    pipe.rotation.y = rotY;
    pipe.position.set(x, 2.9, z);
    pipe.castShadow = true;
    group.add(pipe);
    shootables.push(pipe);
  }

  // Street lamps: poles with warm glowing heads; two real point lights.
  const lampMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.accent), emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 1.6, roughness: 0.4,
  });
  const lamps = [];
  for (const [x, z] of [[-6, 4], [6, -4], [-16, -12], [16, 10]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 4.4, 8), materials.hairline);
    pole.position.set(x, 2.2, z);
    pole.castShadow = true;
    group.add(pole);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), lampMat);
    head.position.set(x, 4.5, z);
    group.add(head);
    lamps.push(head);
  }
  const lampLight1 = new THREE.PointLight(new THREE.Color('#ffb45e'), 22, 18);
  lampLight1.position.set(-6, 4.2, 4);
  scene.add(lampLight1);
  const lampLight2 = new THREE.PointLight(new THREE.Color('#ffb45e'), 22, 18);
  lampLight2.position.set(6, 4.2, -4);
  scene.add(lampLight2);

  // City silhouettes outside the walls: towers and a minaret against the sky.
  const far = new THREE.MeshStandardMaterial({ color: new THREE.Color('#0d0f1a'), roughness: 1 });
  for (const [x, z, w, h] of [[-32, -10, 6, 22], [30, -14, 8, 26], [-34, 12, 5, 16], [34, 8, 6, 20]]) {
    const tower = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), far);
    tower.position.set(x, h / 2, z);
    group.add(tower);
    // A few lit windows on each tower.
    for (let i = 0; i < 5; i += 1) {
      const win = new THREE.Mesh(
        new THREE.PlaneGeometry(0.5, 0.7),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(i % 2 ? '#f0a832' : '#35d0ff') }),
      );
      win.position.set(x + (i % 2 ? w / 2 + 0.01 : -w / 2 - 0.01), 4 + i * 3.2, z);
      win.rotation.y = i % 2 ? Math.PI / 2 : -Math.PI / 2;
      group.add(win);
    }
  }

  // Light: monsoon night. A cool moon key, a warm lamp fill, and a lightning
  // light that sits at zero until a strike — the blackout system drives all
  // three from main.js.
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 4;
  skyCanvas.height = 256;
  const sg = skyCanvas.getContext('2d');
  const grad = sg.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#070912');
  grad.addColorStop(0.5, '#141a30');
  grad.addColorStop(0.75, '#2c2140');
  grad.addColorStop(0.92, '#6b3a4a');
  grad.addColorStop(1, '#a35a35');
  sg.fillStyle = grad;
  sg.fillRect(0, 0, 4, 256);
  const skyTex = new THREE.CanvasTexture(skyCanvas);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(110, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false }),
  );
  scene.add(dome);

  const hemi = new THREE.HemisphereLight(new THREE.Color('#4a5a80'), new THREE.Color('#14100c'), 0.85);
  scene.add(hemi);
  const moon = new THREE.DirectionalLight(new THREE.Color('#9db4ff'), 1.1);
  moon.position.set(-20, 24, -8);
  moon.target.position.set(4, 0, 2);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.camera.left = -30;
  moon.shadow.camera.right = 30;
  moon.shadow.camera.top = 26;
  moon.shadow.camera.bottom = -26;
  moon.shadow.camera.far = 90;
  moon.shadow.bias = -0.0006;
  scene.add(moon, moon.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#ff9a5c'), 0.45);
  fill.position.set(18, 12, 16);
  scene.add(fill);
  // Faint cool fill from the north: without it the north faces of the mid
  // containers go near-black. main.js drives both fills with the blackout.
  const fillNorth = new THREE.DirectionalLight(new THREE.Color('#7a8fc0'), 0.35);
  fillNorth.position.set(-4, 14, -18);
  scene.add(fillNorth);
  const lightning = new THREE.DirectionalLight(new THREE.Color('#eaf2ff'), 0);
  lightning.position.set(10, 30, -10);
  scene.add(lightning, lightning.target);

  // Rain: 1400 short vertical streaks (LineSegments) falling in a box
  // around the camera — points rendered as pale squares before this.
  // Two vertices per drop; the update moves the pair and wraps it to the top.
  const RAIN_COUNT = 1400;
  const STREAK = 0.45;
  const rainPos = new Float32Array(RAIN_COUNT * 6);
  const rainSpeed = new Float32Array(RAIN_COUNT);
  for (let i = 0; i < RAIN_COUNT; i += 1) {
    const x = (Math.random() * 2 - 1) * 20;
    const y = Math.random() * 18;
    const z = (Math.random() * 2 - 1) * 20;
    rainPos[i * 6] = x;
    rainPos[i * 6 + 1] = y;
    rainPos[i * 6 + 2] = z;
    rainPos[i * 6 + 3] = x;
    rainPos[i * 6 + 4] = y - STREAK;
    rainPos[i * 6 + 5] = z;
    rainSpeed[i] = 14 + Math.random() * 10;
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({
    color: new THREE.Color('#9db8d8'), transparent: true, opacity: 0.35,
  }));
  rain.frustumCulled = false;
  scene.add(rain);
  const rainState = { count: RAIN_COUNT, speed: rainSpeed, positions: rainPos, points: rain, streak: STREAK };

  // Waypoint graph: adjacency lists built once from EDGES.
  const adjacency = WAYPOINTS.map(() => []);
  for (const [a, b] of EDGES) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }

  return {
    colliders, shootables, group, waypoints: WAYPOINTS, adjacency,
    hemi, moon, fill, fillNorth, lightning, lampLight1, lampLight2, lamps, lampMat, rain: rainState,
  };
}

// Rain falls around the camera and wraps: drops that hit the street respawn
// at the top of the box, so the storm never runs out of rain. The cloud's
// object position follows the camera, so the storm follows the player.
export function updateRain(world, camera, dt) {
  const { positions, speed, count, points, streak } = world.rain;
  for (let i = 0; i < count; i += 1) {
    let y = positions[i * 6 + 1] - speed[i] * dt;
    if (y < 0) y += 18;
    positions[i * 6 + 1] = y;
    positions[i * 6 + 4] = y - streak;
  }
  points.geometry.attributes.position.needsUpdate = true;
  points.position.set(camera.position.x, 0, camera.position.z);
}
