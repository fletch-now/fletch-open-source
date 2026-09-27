"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { ARROW_OUTLINE } from "@/components/brand/arrow-outline";

// The hero's object, built entirely in Three.js: a thick hewn wooden arrow — the
// mark's own arrowhead outline, extruded — planted in a mound of dark earth with two
// broken timbers crossed behind it, all grown over with moss, lit from a green light
// buried in the crown. Every surface is procedural: 3D value noise shapes the earth
// and roughens the timber, wood grain is drawn to a canvas and used as colour and
// bump, moss is thousands of per-instance-coloured clumps, and real shadow mapping
// ties the planks to the ground.
//
// The canvas is full-bleed and transparent on the page's own ground. Wide screens
// hold the object to the right of the headline; narrow ones put it beneath the
// column. It leans a little toward the pointer and breathes; nothing else moves.

interface Quality {
  moss: number;
  moundSegments: number;
  shadowMap: number;
  motes: number;
  pixelRatio: number;
  parallax: boolean;
}

const FULL: Quality = { moss: 3600, moundSegments: 128, shadowMap: 2048, motes: 56, pixelRatio: 1.5, parallax: true };
const LITE: Quality = { moss: 1400, moundSegments: 80, shadowMap: 1024, motes: 24, pixelRatio: 1.2, parallax: false };

// ---------------------------------------------------------------------------
// Noise
// ---------------------------------------------------------------------------

function hash(x: number, y: number, z: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

// Trilinear value noise on a hashed lattice — smooth lumps, not sine ripples.
function vnoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = smooth(x - xi);
  const fy = smooth(y - yi);
  const fz = smooth(z - zi);
  function corner(dx: number, dy: number, dz: number): number {
    return hash(xi + dx, yi + dy, zi + dz);
  }
  const x00 = corner(0, 0, 0) + (corner(1, 0, 0) - corner(0, 0, 0)) * fx;
  const x10 = corner(0, 1, 0) + (corner(1, 1, 0) - corner(0, 1, 0)) * fx;
  const x01 = corner(0, 0, 1) + (corner(1, 0, 1) - corner(0, 0, 1)) * fx;
  const x11 = corner(0, 1, 1) + (corner(1, 1, 1) - corner(0, 1, 1)) * fx;
  const y0 = x00 + (x10 - x00) * fy;
  const y1 = x01 + (x11 - x01) * fy;
  return y0 + (y1 - y0) * fz;
}

function fbm(x: number, y: number, z: number, octaves: number): number {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let total = 0;
  for (let i = 0; i < octaves; i += 1) {
    value += amplitude * vnoise(x * frequency + i * 17.3, y * frequency + i * 5.1, z * frequency + i * 9.7);
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2.05;
  }
  return value / total;
}

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------

function woodTexture(): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  // Base: bands of slightly different browns across the width.
  for (let x = 0; x < size; x += 4) {
    const t = fbm(x * 0.012, 0.3, 0.7, 3);
    const r = 78 + t * 46;
    const g = 58 + t * 34;
    const b = 38 + t * 22;
    ctx.fillStyle = `rgb(${r | 0}, ${g | 0}, ${b | 0})`;
    ctx.fillRect(x, 0, 4, size);
  }
  // Grain: long dark streaks that wander, denser and darker in places like real
  // split timber.
  for (let i = 0; i < 520; i += 1) {
    const x = hash(i, 1, 0) * size;
    const width = 0.8 + hash(i, 2, 0) * 2.4;
    const tone = 0.12 + hash(i, 3, 0) * 0.5;
    ctx.strokeStyle = `rgba(24, 15, 8, ${tone})`;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    for (let y = 0; y <= size; y += 24) {
      ctx.lineTo(x + Math.sin(y * 0.011 + i * 0.7) * 6 + (fbm(x * 0.02, y * 0.01, i, 2) - 0.5) * 10, y);
    }
    ctx.stroke();
  }
  // Knots.
  for (let i = 0; i < 7; i += 1) {
    const kx = hash(i, 8, 0) * size;
    const ky = hash(i, 9, 0) * size;
    for (let ring = 6; ring > 0; ring -= 1) {
      ctx.strokeStyle = `rgba(30, 18, 9, ${0.35 - ring * 0.04})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(kx, ky, ring * 7, ring * 11, 0.2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  // Fine lighter fibres.
  for (let i = 0; i < 2600; i += 1) {
    ctx.fillStyle = `rgba(150, 118, 84, ${0.05 + hash(i, 5, 0) * 0.1})`;
    ctx.fillRect(hash(i, 6, 0) * size, hash(i, 7, 0) * size, 1, 8 + hash(i, 8, 0) * 30);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function radialTexture(inner: string, outer: string): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(1, outer);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// ---------------------------------------------------------------------------
// The mound
// ---------------------------------------------------------------------------

const MOUND_RADIUS = 2.4;

function moundSurface(direction: THREE.Vector3): THREE.Vector3 {
  const d = direction.clone().normalize();
  const n = fbm(d.x * 2.2 + 3, d.y * 2.2, d.z * 2.2 + 7, 5);
  const fine = fbm(d.x * 9, d.y * 9, d.z * 9, 3);
  const r = MOUND_RADIUS * (0.82 + n * 0.32 + (fine - 0.5) * 0.06);
  const p = d.multiplyScalar(r);
  p.y *= 0.58;
  return p;
}

function buildMound(segments: number): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(1, segments, Math.round(segments * 0.55), 0, Math.PI * 2, 0, Math.PI / 2);
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const dir = new THREE.Vector3();
  const earth = new THREE.Color("#171410");
  const crevice = new THREE.Color("#0b0a08");
  const mossy = new THREE.Color("#3f5a22");
  const tint = new THREE.Color();
  for (let i = 0; i < pos.count; i += 1) {
    dir.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    const p = moundSurface(dir);
    pos.setXYZ(i, p.x, p.y, p.z);
    // Darker where the surface dips, greener toward the crown where moss takes.
    const depth = fbm(p.x * 3 + 11, p.y * 3, p.z * 3 + 2, 3);
    const upness = Math.max(0, dir.y);
    tint.copy(earth).lerp(crevice, Math.max(0, 0.5 - depth) * 1.2);
    tint.lerp(mossy, upness * upness * 0.55 * (0.4 + depth));
    colors[i * 3] = tint.r;
    colors[i * 3 + 1] = tint.g;
    colors[i * 3 + 2] = tint.b;
  }
  pos.needsUpdate = true;
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

// Moss: thousands of small smooth clumps, each with its own green, thick at the
// crown and thinning down the skirt. Per-instance colour keeps one draw call.
function buildMoundMoss(count: number): THREE.InstancedMesh {
  const clump = new THREE.IcosahedronGeometry(0.048, 1);
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#ffffff"),
    emissive: new THREE.Color("#2c5212"),
    emissiveIntensity: 0.35,
    roughness: 0.92,
  });
  const mesh = new THREE.InstancedMesh(clump, material, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const color = new THREE.Color();
  const dark = new THREE.Color("#3a5a1e");
  const bright = new THREE.Color("#a3c552");
  const lit = new THREE.Color("#c9ec6a");
  for (let i = 0; i < count; i += 1) {
    const angle = hash(i, 12, 0) * Math.PI * 2;
    // Biased to the crown, but with patches: a noise gate leaves bare earth between.
    const elevation = Math.pow(hash(i, 11, 0), 0.4) * (Math.PI / 2);
    dir.set(Math.cos(angle) * Math.cos(elevation), Math.sin(elevation), Math.sin(angle) * Math.cos(elevation));
    const patch = fbm(dir.x * 4 + 5, dir.y * 4, dir.z * 4 + 1, 3);
    if (patch < 0.42 && dir.y < 0.8) {
      // Off the mound entirely: collapse the instance.
      s.set(0, 0, 0);
      m.compose(new THREE.Vector3(0, -10, 0), q, s);
      mesh.setMatrixAt(i, m);
      continue;
    }
    const p = moundSurface(dir);
    const scale = 0.5 + hash(i, 13, 0) * 1.2;
    s.set(scale, scale * 0.75, scale);
    q.setFromAxisAngle(new THREE.Vector3(hash(i, 14, 0) - 0.5, 1, hash(i, 15, 0) - 0.5).normalize(), hash(i, 16, 0) * Math.PI);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    // Greener and brighter near the crown light; darker down the skirt.
    const nearLight = Math.max(0, 1 - p.distanceTo(new THREE.Vector3(0, 1.3, 0.2)) / 1.6);
    color.copy(dark).lerp(bright, hash(i, 17, 0) * 0.6 + dir.y * 0.4).lerp(lit, nearLight * nearLight);
    mesh.setColorAt(i, color);
  }
  mesh.receiveShadow = true;
  return mesh;
}

// Loose earth: small dark clods scattered down the skirt.
function buildClods(count: number): THREE.InstancedMesh {
  const clod = new THREE.DodecahedronGeometry(0.06, 0);
  const material = new THREE.MeshStandardMaterial({ color: new THREE.Color("#1e1a14"), roughness: 1, flatShading: true });
  const mesh = new THREE.InstancedMesh(clod, material, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const dir = new THREE.Vector3();
  for (let i = 0; i < count; i += 1) {
    const angle = hash(i, 41, 0) * Math.PI * 2;
    const elevation = hash(i, 42, 0) * 0.9;
    dir.set(Math.cos(angle) * Math.cos(elevation), Math.sin(elevation), Math.sin(angle) * Math.cos(elevation));
    const p = moundSurface(dir);
    const scale = 0.4 + hash(i, 43, 0) * 1.3;
    s.set(scale, scale * 0.7, scale);
    q.setFromAxisAngle(new THREE.Vector3(1, hash(i, 44, 0), 0).normalize(), hash(i, 45, 0) * Math.PI);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// ---------------------------------------------------------------------------
// Timber
// ---------------------------------------------------------------------------

function woodMaterial(texture: THREE.Texture, tint: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: texture,
    color: new THREE.Color(tint),
    roughness: 0.94,
    metalness: 0,
    bumpMap: texture,
    bumpScale: 1.4,
  });
}

// A hewn plank: a box roughened along its length, with one end splintered.
function buildPlank(material: THREE.Material, width: number, thickness: number, length: number, splinter: number): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(width, length, thickness, 6, 48, 4);
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = fbm(x * 5 + 2, y * 1.6, z * 5 + 4, 3) - 0.5;
    const ridge = fbm(x * 12, y * 0.4 + 3, z * 12, 2) - 0.5;
    let sx = 1 + n * 0.16 + ridge * 0.08;
    let sz = 1 + n * 0.16 - ridge * 0.06;
    // The top end breaks into splinters: pull vertices unevenly along the length.
    let sy = y;
    const tipness = Math.max(0, (y - length / 2 + 0.35) / 0.35);
    if (tipness > 0) {
      const tear = fbm(x * 14 + 9, z * 14, 1, 2);
      sy = y - tipness * splinter * tear;
      sx *= 1 - tipness * 0.35;
      sz *= 1 - tipness * 0.35;
    }
    pos.setXYZ(i, x * sx, sy, z * sz);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.translate(0, length / 2, 0);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// The head: the mark's silhouette extruded thick, bevelled, roughened.
function buildHead(material: THREE.Material): THREE.Mesh {
  const shape = new THREE.Shape();
  ARROW_OUTLINE.forEach(function trace([x, y], i) {
    const px = (x - 12) / 6;
    const py = -(y - 12) / 6;
    if (i === 0) shape.moveTo(px, py);
    else shape.lineTo(px, py);
  });
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.3,
    bevelEnabled: true,
    bevelThickness: 0.06,
    bevelSize: 0.05,
    bevelSegments: 3,
    curveSegments: 4,
  });
  geometry.computeVertexNormals();
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const nor = geometry.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = (fbm(x * 6 + 1, y * 6, z * 6 + 3, 3) - 0.5) * 0.05;
    pos.setXYZ(i, x + nor.getX(i) * n, y + nor.getY(i) * n, z + nor.getZ(i) * n);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  // Centre the extrusion and turn the outline so its axis runs along +y; the tail
  // notch then sits on the shaft's end.
  geometry.translate(0, 0, -0.15);
  geometry.rotateZ(-0.64);
  geometry.scale(0.7, 0.7, 1);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Moss climbing a plank: clumps around its surface near the base, thinning upward.
function buildClimbingMoss(count: number, width: number, thickness: number, height: number): THREE.InstancedMesh {
  const clump = new THREE.IcosahedronGeometry(0.04, 1);
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#ffffff"),
    emissive: new THREE.Color("#2c5212"),
    emissiveIntensity: 0.3,
    roughness: 0.92,
  });
  const mesh = new THREE.InstancedMesh(clump, material, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const color = new THREE.Color();
  const dark = new THREE.Color("#476624");
  const bright = new THREE.Color("#a8c957");
  for (let i = 0; i < count; i += 1) {
    const y = Math.pow(hash(i, 21, 0), 1.8) * height;
    const face = hash(i, 22, 0);
    // Pick a face of the box and sit just proud of it.
    if (face < 0.25) p.set(width / 2 + 0.02, y, (hash(i, 23, 0) - 0.5) * thickness);
    else if (face < 0.5) p.set(-width / 2 - 0.02, y, (hash(i, 23, 0) - 0.5) * thickness);
    else if (face < 0.75) p.set((hash(i, 23, 0) - 0.5) * width, y, thickness / 2 + 0.02);
    else p.set((hash(i, 23, 0) - 0.5) * width, y, -thickness / 2 - 0.02);
    const scale = (0.5 + hash(i, 24, 0) * 1.1) * (1 - (y / height) * 0.55);
    s.set(scale, scale * 0.8, scale);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(i, 25, 0) * Math.PI * 2);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    color.copy(dark).lerp(bright, hash(i, 26, 0));
    mesh.setColorAt(i, color);
  }
  mesh.receiveShadow = true;
  return mesh;
}

function buildMotes(count: number): THREE.Points {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (hash(i, 31, 0) - 0.5) * 1.6;
    positions[i * 3 + 1] = 1.2 + hash(i, 32, 0) * 2.4;
    positions[i * 3 + 2] = (hash(i, 33, 0) - 0.5) * 1.2;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: new THREE.Color("#d2ff9a"),
    size: 0.03,
    transparent: true,
    opacity: 0.7,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  return new THREE.Points(geometry, material);
}

function disposeObject(obj: THREE.Object3D): void {
  const mesh = obj as THREE.Mesh;
  if (mesh.geometry) mesh.geometry.dispose();
  const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
  const list = Array.isArray(material) ? material : material ? [material] : [];
  list.forEach(function disposeMaterial(mat) {
    const textured = mat as THREE.Material & Record<string, unknown>;
    ["map", "bumpMap"].forEach(function drop(key) {
      const texture = textured[key];
      if (texture instanceof THREE.Texture) texture.dispose();
    });
    mat.dispose();
  });
}

export function ArrowMonument({ className = "" }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(function mount() {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const quality = window.matchMedia("(max-width: 767px), (pointer: coarse)").matches ? LITE : FULL;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 50);
    camera.position.set(0, 1.9, 11);
    const lookAt = new THREE.Vector3(0, 1.5, 0);

    // Light. A cool key from the upper left with shadows, a faint warm fill from
    // behind right, and the green light buried in the crown that does the real work.
    scene.add(new THREE.HemisphereLight(new THREE.Color("#2e332b"), new THREE.Color("#060704"), 0.55));
    const key = new THREE.DirectionalLight(new THREE.Color("#e9e7d8"), 1.15);
    key.position.set(-6, 9, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(quality.shadowMap, quality.shadowMap);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 30;
    key.shadow.camera.left = -4;
    key.shadow.camera.right = 4;
    key.shadow.camera.top = 6;
    key.shadow.camera.bottom = -2;
    key.shadow.bias = -0.0008;
    key.shadow.radius = 4;
    scene.add(key);
    const fill = new THREE.DirectionalLight(new THREE.Color("#6f7d5e"), 0.3);
    fill.position.set(5, 3, -5);
    scene.add(fill);
    const buried = new THREE.PointLight(new THREE.Color("#9dff55"), 16, 5, 2);
    buried.position.set(0, 1.2, 0.35);
    scene.add(buried);
    const above = new THREE.PointLight(new THREE.Color("#86ff48"), 3.5, 3.6, 2);
    above.position.set(0.25, 2.1, 1.1);
    scene.add(above);

    // The object, as one rig.
    const rig = new THREE.Group();
    scene.add(rig);
    rig.add(buildMound(quality.moundSegments));
    rig.add(buildMoundMoss(quality.moss));
    rig.add(buildClods(Math.round(quality.moss * 0.12)));

    const grain = woodTexture();
    grain.repeat.set(1, 2.5);
    const timber = woodMaterial(grain, "#8a6d4d");
    const darkTimber = woodMaterial(grain, "#6d573f");

    // The arrow: shaft from the crown, head on its end, leaning up and to the right.
    const arrow = new THREE.Group();
    const shaftLength = 4.3;
    arrow.add(buildPlank(timber, 0.36, 0.3, shaftLength, 0));
    const head = buildHead(timber);
    head.position.y = shaftLength - 0.15;
    arrow.add(head);
    arrow.add(buildClimbingMoss(Math.round(quality.moss * 0.09), 0.36, 0.3, 1.9));
    arrow.position.set(0, 1.05, 0.1);
    arrow.rotation.set(0.08, 0.15, -0.5);
    rig.add(arrow);

    // Two broken timbers crossed behind: one long leaning left, one short and
    // shattered leaning further.
    const crossOne = new THREE.Group();
    crossOne.add(buildPlank(darkTimber, 0.34, 0.26, 3.4, 0.5));
    crossOne.add(buildClimbingMoss(Math.round(quality.moss * 0.05), 0.34, 0.26, 1.3));
    crossOne.position.set(0.2, 1.05, -0.35);
    crossOne.rotation.set(-0.12, 0.35, 0.78);
    rig.add(crossOne);
    const crossTwo = new THREE.Group();
    crossTwo.add(buildPlank(darkTimber, 0.3, 0.24, 2.6, 0.7));
    crossTwo.add(buildClimbingMoss(Math.round(quality.moss * 0.04), 0.3, 0.24, 1.1));
    crossTwo.position.set(-0.15, 1.1, -0.1);
    crossTwo.rotation.set(0.1, -0.2, 1.05);
    rig.add(crossTwo);

    // The glow pool at the crown, and the motes above it.
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: radialTexture("rgba(170, 250, 100, 0.85)", "rgba(40, 100, 20, 0)"),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0.4,
      }),
    );
    glow.scale.set(2.6, 1.5, 1);
    glow.position.set(0, 1.3, 0.55);
    rig.add(glow);
    const motes = buildMotes(quality.motes);
    rig.add(motes);

    const pointer = { x: 0, y: 0 };
    function onPointer(event: PointerEvent): void {
      pointer.x = (event.clientX / window.innerWidth - 0.5) * 2;
      pointer.y = (event.clientY / window.innerHeight - 0.5) * 2;
    }

    let frame = 0;
    let visible = true;
    let simTime = reduced ? 2 : 0;
    let wide = true;
    let anchorX = 0;
    let anchorY = 0;
    const clock = new THREE.Clock();
    const motePositions = motes.geometry.attributes.position as THREE.BufferAttribute;

    function render(dt: number): void {
      simTime += dt;
      const breath = 1 + Math.sin(simTime * 0.5) * 0.08;
      buried.intensity = 16 * breath;
      glow.material.opacity = 0.4 * breath;
      if (dt > 0) {
        for (let i = 0; i < motePositions.count; i += 1) {
          let y = motePositions.getY(i) + (0.08 + hash(i, 1, 1) * 0.1) * dt;
          if (y > 3.8) y = 1.2;
          motePositions.setY(i, y);
          motePositions.setX(i, motePositions.getX(i) + Math.sin(simTime * 0.5 + i) * 0.0012);
        }
        motePositions.needsUpdate = true;
      }
      const targetY = (quality.parallax ? pointer.x * 0.14 : 0) + Math.sin(simTime * 0.2) * 0.04;
      const targetX = (quality.parallax ? -pointer.y * 0.06 : 0);
      rig.rotation.y += (targetY - rig.rotation.y) * 0.05;
      rig.rotation.x += (targetX - rig.rotation.x) * 0.05;
      rig.position.set(anchorX, anchorY, 0);
      camera.lookAt(lookAt);
      renderer.render(scene, camera);
    }

    function tick(): void {
      render(Math.min(clock.getDelta(), 0.05));
      frame = visible && !document.hidden && !reduced ? requestAnimationFrame(tick) : 0;
    }

    function resize(): void {
      const w = host!.clientWidth;
      const h = host!.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      wide = camera.aspect > 1.05;
      const visibleHeight = 2 * Math.tan((camera.fov * Math.PI) / 360) * camera.position.z;
      const visibleWidth = visibleHeight * camera.aspect;
      // Wide: held in the right third, a little below centre. Narrow: beneath the
      // column, in the lower part of the section.
      anchorX = wide ? visibleWidth * 0.27 : 0;
      anchorY = wide ? -0.9 : -2.9;
      const objectHeight = 6.2;
      const fit = wide ? Math.min(0.92, (visibleHeight * 0.78) / objectHeight) : Math.min(0.8, (visibleWidth * 0.95) / 5.2);
      rig.scale.setScalar(fit);
      render(0);
    }

    const resizeObserver = new ResizeObserver(resize);
    const intersection = new IntersectionObserver(function onCross(entries) {
      visible = entries[0]?.isIntersecting ?? true;
      if (visible && !frame && !reduced) {
        clock.getDelta();
        frame = requestAnimationFrame(tick);
      }
      if (!visible && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    });
    resizeObserver.observe(host);
    intersection.observe(host);
    if (quality.parallax) window.addEventListener("pointermove", onPointer, { passive: true });
    resize();
    if (!reduced) frame = requestAnimationFrame(tick);

    return function unmount() {
      if (frame) cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersection.disconnect();
      window.removeEventListener("pointermove", onPointer);
      scene.traverse(disposeObject);
      renderer.dispose();
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={hostRef} aria-hidden="true" className={`absolute inset-0 [&>canvas]:block [&>canvas]:h-full [&>canvas]:w-full ${className}`} />;
}
