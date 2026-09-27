"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

// The hero, in Three.js, reduced to its two ideas: a moonlit field of grass moving
// under a gust of wind, and Fletch arrowheads — the banner photograph — appearing in
// the air above it, one at a time, the way apps come out of a build. Each arrives
// softly inside its own glow, floats on integrated physics, and dissolves.
//
// Everything runs on an accumulated simulation time that only advances while the
// hero is on screen, so scrolling away and back never jumps the world — the field
// resumes exactly where it paused, and every lifecycle loops seamlessly.

interface Quality {
  grass: number;
  nearGrass: number;
  flights: number;
  pixelRatio: number;
  parallax: boolean;
}

const FULL: Quality = { grass: 14000, nearGrass: 1000, flights: 4, pixelRatio: 1.5, parallax: true };
const LITE: Quality = { grass: 5000, nearGrass: 450, flights: 3, pixelRatio: 1.2, parallax: false };

// One life: arrive, hold, dissolve — all long and eased, nothing snaps.
const SPAWN_SECONDS = 2.6;
const LIVE_SECONDS = 9;
const FADE_SECONDS = 3.2;
const LIFE_SECONDS = SPAWN_SECONDS + LIVE_SECONDS + FADE_SECONDS;

// Forces, per second: buoyancy against drag, a weak spring to its spot, and a smooth
// wind field sampled at the head's own position so no two feel the same push.
const BUOYANCY = 0.05;
const DRAG = 1.1;
const SPRING = 0.07;
const WIND = 0.2;
const FADE_LIFT = 0.22;

function hash(x: number, y: number, z: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

function smootherstep(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// Flat in front of the camera, rolling gently away behind.
function terrainHeight(x: number, z: number): number {
  const d = -z;
  if (d < 6) return 0;
  const ramp = Math.min(1, (d - 6) / 16);
  const ease = ramp * ramp * (3 - 2 * ramp);
  const rolling = Math.sin(x * 0.085 + 1.3) * 1.4 + Math.sin(x * 0.03 - d * 0.05) * 2.2;
  return ease * (rolling + 2.2 + (d - 6) * 0.06);
}

function radialTexture(inner: string, outer: string): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(1, outer);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// ---------------------------------------------------------------------------
// The flight.
// ---------------------------------------------------------------------------

interface ArrowTextures {
  map: THREE.Texture;
  alpha: THREE.Texture;
}

// The photograph was cut onto a square canvas with 6% padding; the quad carries it
// at that ratio so the arrowhead fills the same box the logo does.
const ARROW_PLANE = 22 / 6 / (1 - 2 * 0.06);
const ARROW_TEXTURES = {
  map: "/brand/arrow-albedo.jpg",
  alpha: "/brand/arrow-alpha.png",
};

interface Flight {
  group: THREE.Group;
  material: THREE.MeshBasicMaterial;
  mesh: THREE.Mesh;
  glow: THREE.Sprite;
  cycle: number;
  offset: number;
  home: THREE.Vector3;
  velocity: THREE.Vector3;
  angle: number;
  angularVelocity: number;
  seed: number;
  size: number;
}

function buildFlight(count: number, textures: ArrowTextures): { group: THREE.Group; flights: Flight[] } {
  const root = new THREE.Group();
  const quad = new THREE.PlaneGeometry(ARROW_PLANE, ARROW_PLANE);
  const glowTexture = radialTexture("rgba(130, 235, 130, 0.55)", "rgba(20, 110, 40, 0)");
  const flights: Flight[] = [];

  for (let i = 0; i < count; i += 1) {
    // Unlit and outside tone mapping, so the photograph keeps the banner's own
    // colour. One material per head — its opacity is its lifecycle.
    const material = new THREE.MeshBasicMaterial({
      map: textures.map,
      alphaMap: textures.alpha,
      alphaTest: 0.3,
      transparent: true,
      opacity: 0,
      toneMapped: false,
      fog: false,
    });
    const mesh = new THREE.Mesh(quad, material);

    // A soft aura that arrives ahead of the head and carries its fade — one sprite,
    // no particles, nothing to jitter.
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0,
        toneMapped: false,
      }),
    );
    glow.scale.setScalar(3.4);
    glow.position.z = -0.15;

    const group = new THREE.Group();
    group.add(glow);
    group.add(mesh);
    group.visible = false;
    root.add(group);

    flights.push({
      group,
      material,
      mesh,
      glow,
      cycle: -1,
      offset: (i / count) * LIFE_SECONDS,
      home: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      angle: 0,
      angularVelocity: 0,
      seed: hash(i, 9, 9) * 100,
      size: 0.15,
    });
  }
  return { group: root, flights };
}

// A new life: a fresh spot in the air — left or right of the headline column, never
// behind it — and everything at rest.
function respawn(f: Flight, index: number, cycle: number): void {
  f.cycle = cycle;
  const side = hash(index, cycle, 4) < 0.5 ? -1 : 1;
  f.home.set(
    side * (2.4 + hash(index, cycle, 5) * 3.4),
    2.3 + hash(index, cycle, 6) * 2.2,
    -1.5 - hash(index, cycle, 7) * 4.5,
  );
  f.group.position.copy(f.home);
  f.velocity.set(0, 0, 0);
  f.angle = (hash(index, cycle, 8) - 0.5) * 0.9;
  f.angularVelocity = 0;
  f.size = 0.13 + hash(index, cycle, 9) * 0.08;
}

function updateFlight(f: Flight, index: number, t: number, dt: number, camera: THREE.Camera): void {
  const local = (t + f.offset) % LIFE_SECONDS;
  const cycle = Math.floor((t + f.offset) / LIFE_SECONDS);
  if (cycle !== f.cycle) respawn(f, index, cycle);

  // ---- lifecycle: everything driven by two eased scalars, so nothing can snap.
  const arriveP = smootherstep(local / SPAWN_SECONDS);
  const fadeP = smootherstep((local - SPAWN_SECONDS - LIVE_SECONDS) / FADE_SECONDS);
  const presence = arriveP * (1 - fadeP);
  f.group.visible = presence > 0.002;
  f.material.opacity = presence;
  // The glow leads: it is brightest while the head is still forming, then settles
  // to a faint aura, and swells again slightly as the head lets go.
  f.glow.material.opacity = 0.5 * arriveP * (1 - arriveP) * 4 * 0.6 + 0.16 * presence + 0.25 * fadeP * (1 - fadeP);
  // Scale eases over a narrow range — no overshoot, no growing from nothing.
  f.group.scale.setScalar(f.size * (0.82 + 0.18 * arriveP));

  // ---- integrated motion: forces to velocity to position.
  if (dt > 0) {
    const p = f.group.position;
    const windX = (Math.sin(t * 0.34 + p.y * 0.8 + f.seed) + Math.sin(t * 0.15 + p.z * 0.6 + f.seed * 2) * 0.6) * WIND;
    const windY = Math.sin(t * 0.27 + p.x * 0.5 + f.seed * 3) * WIND * 0.4;
    const windZ = Math.sin(t * 0.21 + p.x * 0.4 + f.seed * 5) * WIND * 0.4;
    f.velocity.x += (windX + (f.home.x - p.x) * SPRING - f.velocity.x * DRAG) * dt;
    f.velocity.y += (BUOYANCY + windY + (f.home.y - p.y) * SPRING - f.velocity.y * DRAG + FADE_LIFT * fadeP) * dt;
    f.velocity.z += (windZ + (f.home.z - p.z) * SPRING - f.velocity.z * DRAG) * dt;
    p.addScaledVector(f.velocity, dt);

    // Angular motion: a slow smooth torque against damping — each head turns a
    // little, differently, and never winds up.
    const torque = Math.sin(t * 0.22 + f.seed * 7) * 0.22;
    f.angularVelocity += (torque - f.angularVelocity * 1.3) * dt;
    f.angle += f.angularVelocity * dt;
  }

  // ---- pose: face the camera, hang at its own angle, lean gently into motion.
  f.mesh.quaternion.copy(camera.quaternion);
  const lean = THREE.MathUtils.clamp(-f.velocity.x * 0.6, -0.25, 0.25);
  f.mesh.rotateZ(f.angle + lean);
}

// ---------------------------------------------------------------------------
// The field.
// ---------------------------------------------------------------------------

function buildTerrain(): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(180, 120, 90, 60);
  geometry.rotateX(-Math.PI / 2);
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const z = pos.getZ(i) - 40;
    pos.setY(i, terrainHeight(x, z));
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ color: new THREE.Color("#191d1a"), roughness: 1, metalness: 0 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = -40;
  return mesh;
}

function buildGrass(count: number, near: number): THREE.InstancedMesh {
  const blade = new THREE.PlaneGeometry(0.036, 0.46, 1, 4);
  blade.translate(0, 0.23, 0);
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    side: THREE.DoubleSide,
    vertexShader: `
      uniform float uTime;
      varying float vHeight;
      varying float vTone;
      void main() {
        vHeight = uv.y;
        vec4 world = instanceMatrix * vec4(position, 1.0);
        vTone = fract(sin(world.x * 12.9898 + world.z * 78.233) * 43758.5453);
        // Layered wind: a per-blade flutter under a broad gust wave that scrolls
        // across the field, so wind arrives as weather moving through the meadow.
        float phase = world.x * 0.9 + world.z * 0.6;
        float gust = sin(world.x * 0.14 + world.z * 0.09 - uTime * 0.7) * 0.5
                   + sin(world.x * 0.05 - uTime * 0.31) * 0.5;
        float flutter = sin(uTime * 1.7 + phase) * 0.05 + sin(uTime * 2.9 + phase * 1.7) * 0.025;
        float sway = flutter + gust * 0.09 + 0.03;
        float lean = (vTone - 0.5) * 0.12;
        world.x += (sway + lean) * vHeight * vHeight;
        world.z += (sway * 0.35 + lean * 0.5) * vHeight * vHeight;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `
      varying float vHeight;
      varying float vTone;
      void main() {
        vec3 base = vec3(0.025, 0.055, 0.03);
        vec3 tip = mix(vec3(0.13, 0.24, 0.09), vec3(0.19, 0.3, 0.12), vTone);
        vec3 c = mix(base, tip, pow(vHeight, 1.7));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const grass = new THREE.InstancedMesh(blade, material, count + near);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < count; i += 1) {
    const x = (hash(i, 1, 0) - 0.5) * 44;
    const z = -0.3 - Math.pow(hash(i, 2, 0), 1.35) * 15;
    const scale = 0.45 + hash(i, 3, 0) * 0.6;
    p.set(x, terrainHeight(x, z), z);
    q.setFromAxisAngle(up, hash(i, 4, 0) * Math.PI);
    s.set(1, scale, 1);
    m.compose(p, q, s);
    grass.setMatrixAt(i, m);
  }
  // The foreground rank: blades just in front of the camera, so the meadow crosses
  // the bottom of the frame as silhouettes.
  for (let i = 0; i < near; i += 1) {
    const x = (hash(i, 21, 0) - 0.5) * 16;
    const z = 3 + hash(i, 22, 0) * 3.4;
    const scale = 0.7 + hash(i, 23, 0) * 0.5;
    p.set(x, 0, z);
    q.setFromAxisAngle(up, hash(i, 24, 0) * Math.PI);
    s.set(1.15, scale, 1);
    m.compose(p, q, s);
    grass.setMatrixAt(count + i, m);
  }
  return grass;
}

function disposeObject(obj: THREE.Object3D): void {
  const mesh = obj as THREE.Mesh;
  if (mesh.geometry) mesh.geometry.dispose();
  const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
  const list = Array.isArray(material) ? material : material ? [material] : [];
  list.forEach(function disposeMaterial(mat) {
    const textured = mat as THREE.Material & Record<string, unknown>;
    ["map", "alphaMap"].forEach(function drop(key) {
      const texture = textured[key];
      if (texture instanceof THREE.Texture) texture.dispose();
    });
    mat.dispose();
  });
}

export function ForestScene({ className = "" }: { className?: string }) {
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
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(new THREE.Color("#0c0f0d"), 0.026);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 160);
    camera.position.set(0, 1.9, 7.5);

    // Night light: a neutral sky bounce and moonlight from the upper left; the only
    // green in the frame is the grass itself and the mark.
    scene.add(new THREE.HemisphereLight(new THREE.Color("#4d5651"), new THREE.Color("#0c0e0d"), 1.1));
    const moonlight = new THREE.DirectionalLight(new THREE.Color("#dfe3e0"), 1.4);
    moonlight.position.set(-14, 16, -20);
    scene.add(moonlight);

    scene.add(buildTerrain());
    const grass = buildGrass(quality.grass, quality.nearGrass);
    scene.add(grass);

    // The arrowheads carry the banner photograph, so they join the scene once its
    // maps arrive; the field stands on its own until then.
    let flight: { group: THREE.Group; flights: Flight[] } | null = null;
    let unmounted = false;
    const loader = new THREE.TextureLoader();
    const anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    Promise.all([loader.loadAsync(ARROW_TEXTURES.map), loader.loadAsync(ARROW_TEXTURES.alpha)])
      .then(function attach([map, alpha]) {
        if (unmounted) {
          [map, alpha].forEach(function drop(texture) { texture.dispose(); });
          return;
        }
        map.colorSpace = THREE.SRGBColorSpace;
        [map, alpha].forEach(function tune(texture) { texture.anisotropy = anisotropy; });
        flight = buildFlight(quality.flights, { map, alpha });
        scene.add(flight.group);
        render(0);
      })
      .catch(function ignore() {
        // The field stands without the flight; the mark is still in the header.
      });

    const pointer = { x: 0, y: 0 };
    function onPointer(event: PointerEvent): void {
      pointer.x = (event.clientX / window.innerWidth - 0.5) * 2;
      pointer.y = (event.clientY / window.innerHeight - 0.5) * 2;
    }

    let frame = 0;
    let visible = true;
    // Simulation time only advances while rendering, so a pause never jumps the
    // world and every lifecycle loops without a seam.
    let simTime = reduced ? 4.2 : 0;
    const clock = new THREE.Clock();
    const grassMaterial = grass.material as THREE.ShaderMaterial;

    function render(dt: number): void {
      simTime += dt;
      grassMaterial.uniforms.uTime.value = simTime;

      if (flight) {
        flight.flights.forEach(function step(f, i) {
          updateFlight(f, i, simTime, dt, camera);
        });
      }

      camera.position.x += (pointer.x * 0.5 - camera.position.x) * 0.04;
      camera.position.y += (1.9 - pointer.y * 0.25 - camera.position.y) * 0.04;
      camera.lookAt(0.4, 1.6, -1);
      renderer.render(scene, camera);
    }

    function tick(): void {
      // Clamped so a slow frame integrates a small honest step, never a leap.
      render(Math.min(clock.getDelta(), 0.05));
      frame = visible && !document.hidden && !reduced ? requestAnimationFrame(tick) : 0;
    }

    function resize(): void {
      const w = host!.clientWidth;
      const h = host!.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      render(0);
    }

    const resizeObserver = new ResizeObserver(resize);
    const intersection = new IntersectionObserver(function onCross(entries) {
      visible = entries[0]?.isIntersecting ?? true;
      if (visible && !frame && !reduced) {
        // Swallow the time that passed while hidden, then resume.
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
      unmounted = true;
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
