"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { ARROW_MAPS, ARROW_PLANE } from "@/components/brand/arrow-outline";

// The mark in three dimensions: the banner photograph on two faces, turning slowly
// under a cool key light and a green rim. Face-on it is the logo. Between the two
// faces sit a stack of dark slices cut by the same alpha map, so edge-on the mark
// has a solid side with exactly the photograph's silhouette. An extruded outline
// was tried first and never matched the cut-out. Transparent canvas, so it sits on
// whatever the section is.
//
// A browser without WebGL (a headless client, a tab whose GPU process died, a
// locked-down device) throws from the renderer's constructor. That used to take
// the whole page down to the error boundary; now it shows the flat mark instead.

const DEPTH = 0.18;
const SLICES = 18;

function disposeObject(obj: THREE.Object3D): void {
  const mesh = obj as THREE.Mesh;
  if (mesh.geometry) mesh.geometry.dispose();
  const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
  let materials: THREE.Material[];
  if (Array.isArray(material)) {
    materials = material;
  } else if (material) {
    materials = [material];
  } else {
    materials = [];
  }
  materials.forEach(function disposeMaterial(mat) {
    const textured = mat as THREE.Material & Record<string, unknown>;
    ["map", "alphaMap", "normalMap", "emissiveMap"].forEach(function drop(key) {
      const texture = textured[key];
      if (texture instanceof THREE.Texture) texture.dispose();
    });
    mat.dispose();
  });
}

interface SpinningMarkProps {
  className?: string;
}

function createRenderer(): THREE.WebGLRenderer | null {
  try {
    return new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    return null;
  }
}

// The flat mark, for hosts that cannot draw the turning one.
function mountFlatMark(host: HTMLDivElement): () => void {
  const img = document.createElement("img");
  img.src = "/brand/mark-green-512.png";
  img.alt = "";
  img.className = "absolute left-1/2 top-1/2 h-[46%] w-auto -translate-x-1/2 -translate-y-1/2 opacity-90";
  host.appendChild(img);
  return function unmount() {
    img.remove();
  };
}

export function SpinningMark({ className = "" }: SpinningMarkProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(function mount() {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const created = createRenderer();
    if (!created) {
      return mountFlatMark(host);
    }
    const renderer = created;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 30);
    camera.position.set(0, 0.1, 9);

    scene.add(new THREE.HemisphereLight(new THREE.Color("#40463c"), new THREE.Color("#0a0c09"), 0.7));
    const key = new THREE.DirectionalLight(new THREE.Color("#f0eadb"), 1.8);
    key.position.set(-4, 5, 6);
    scene.add(key);
    const rim = new THREE.DirectionalLight(new THREE.Color("#7dff4a"), 1.1);
    rim.position.set(5, -2, -4);
    scene.add(rim);

    const rig = new THREE.Group();
    rig.rotation.z = 0.12;
    scene.add(rig);

    let unmounted = false;
    const loader = new THREE.TextureLoader();
    Promise.all([loader.loadAsync(ARROW_MAPS.map), loader.loadAsync(ARROW_MAPS.alpha), loader.loadAsync(ARROW_MAPS.normal)])
      .then(function attach([map, alpha, normal]) {
        if (unmounted) {
          [map, alpha, normal].forEach(function drop(texture) { texture.dispose(); });
          return;
        }
        map.colorSpace = THREE.SRGBColorSpace;
        [map, alpha, normal].forEach(function tune(texture) { texture.anisotropy = 4; });
        const photo = new THREE.MeshStandardMaterial({
          map,
          alphaMap: alpha,
          alphaTest: 0.4,
          normalMap: normal,
          normalScale: new THREE.Vector2(0.9, 0.9),
          roughness: 0.85,
          metalness: 0,
          emissive: new THREE.Color("#ffffff"),
          emissiveMap: map,
          emissiveIntensity: 0.5,
        });
        const quad = new THREE.PlaneGeometry(ARROW_PLANE, ARROW_PLANE);
        const front = new THREE.Mesh(quad, photo);
        front.position.z = DEPTH / 2 + 0.004;
        // The back face is the same un-rotated quad drawn from behind (BackSide),
        // not a quad turned by PI. Turning it mirrors the silhouette in world space
        // and the asymmetric arrow then never lines up with the slices between the
        // faces; from a three-quarter angle that showed as a second, offset arrow.
        const backPhoto = photo.clone();
        backPhoto.side = THREE.BackSide;
        const back = new THREE.Mesh(quad, backPhoto);
        back.position.z = -(DEPTH / 2 + 0.004);
        rig.add(front, back);
        // The side: slices of the same bark, darkened, cut by the same alpha map, so
        // edge-on the mark reads as one solid piece of wood.
        const side = new THREE.MeshStandardMaterial({
          map,
          color: new THREE.Color("#6f6f6f"),
          alphaMap: alpha,
          alphaTest: 0.4,
          roughness: 0.95,
          metalness: 0,
          side: THREE.DoubleSide,
        });
        for (let i = 1; i < SLICES; i += 1) {
          const slice = new THREE.Mesh(quad, side);
          slice.position.z = -DEPTH / 2 + (DEPTH * i) / SLICES;
          rig.add(slice);
        }
        render(0);
      })
      .catch(function ignore() {
        // The solid alone still reads as the mark.
      });

    let frame = 0;
    let visible = true;
    let simTime = reduced ? 0.6 : 0;
    const clock = new THREE.Clock();

    function render(dt: number): void {
      simTime += dt;
      rig.rotation.y = simTime * 0.55;
      rig.rotation.x = Math.sin(simTime * 0.4) * 0.08;
      rig.position.y = Math.sin(simTime * 0.7) * 0.06;
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
      const visibleHeight = 2 * Math.tan((camera.fov * Math.PI) / 360) * camera.position.z;
      const visibleWidth = visibleHeight * camera.aspect;
      rig.scale.setScalar(Math.min(visibleHeight, visibleWidth) * 0.19);
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
    resize();
    if (!reduced) frame = requestAnimationFrame(tick);

    return function unmount() {
      unmounted = true;
      if (frame) cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersection.disconnect();
      scene.traverse(disposeObject);
      renderer.dispose();
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={hostRef} aria-hidden="true" className={`absolute inset-0 [&>canvas]:block [&>canvas]:h-full [&>canvas]:w-full ${className}`} />;
}
