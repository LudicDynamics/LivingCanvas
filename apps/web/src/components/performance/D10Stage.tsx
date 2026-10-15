import type { BufferGeometry, Material, Object3D, Texture } from 'three';
import type { D10Trajectory } from '../../lib/d10-physics.js';
import React, { useEffect, useRef, useState } from 'react';
import { diceStageDisplay } from '../../lib/d10-display.js';
import { useStill } from '../../lib/motion.js';
import './d10-stage.css';
import type { PerformanceSettings } from '../../lib/performance-settings.js';

// Registered asset provenance: assets/models/arcane-d10/README.md and validation.json.
const modelUrl = new URL('../../../../../assets/models/arcane-d10/noctiluca-d10.glb', import.meta.url).href;
/** Give up on WebGL and show the number if loading and simulating take longer than this. */
const LOAD_TIMEOUT_MS = 10_000;

interface D10StageProps {
  dice: string;
  rolls?: number[];
  settled: boolean;
  onLanded?: () => void;
  diceRendering: PerformanceSettings['diceRendering'];
  /** Hide the tray rails when the stage is embedded in the ceremony card. */
  integrated?: boolean;
}

/** Bounded WebGL presentation. It never creates or changes an authoritative roll. */
export function D10Stage({ dice, rolls, settled, onLanded, diceRendering, integrated = false }: D10StageProps) {
  const host = useRef<HTMLDivElement>(null);
  const landed = useRef(onLanded);
  landed.current = onLanded;
  // Read at mount only: settling after the dice land must not rebuild the scene.
  const settledRef = useRef(settled);
  settledRef.current = settled;
  const completedKeys = useRef(new Set<string>());
  const still = useStill();
  const [fallback, setFallback] = useState(false);
  const display = diceStageDisplay(dice, rolls);
  const key = JSON.stringify([dice, rolls]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let cancelled = false;
    let finished = false;
    let frame = 0;
    let teardown = () => {};
    let visibilityListener: (() => void) | null = null;
    const complete = () => {
      if (cancelled || finished || !rolls) return;
      finished = true;
      if (completedKeys.current.has(key)) return;
      completedKeys.current.add(key);
      landed.current?.();
    };
    if (diceRendering === 'numeric' || still) {
      setFallback(true);
      complete();
      return () => {
        cancelled = true;
      };
    }
    const settledAtMount = settledRef.current;
    // Covers loading and simulation only; it is cleared once the throw plays.
    const watchdog = window.setTimeout(() => {
      setFallback(true);
      complete();
    }, LOAD_TIMEOUT_MS);

    setFallback(false);
    if (!display) {
      setFallback(true);
      const timer = window.setTimeout(complete, still ? 180 : 1200);
      return () => {
        cancelled = true;
        window.clearTimeout(timer);
        window.clearTimeout(watchdog);
      };
    }

    void (async () => {
      try {
        const [T, { GLTFLoader }, { RoomEnvironment }, { d10Landing }, { simulateD10Throw, d6Landing, D6_VALUES }] = await Promise.all([
          import('three'),
          import('three/addons/loaders/GLTFLoader.js'),
          import('three/addons/environments/RoomEnvironment.js'),
          import('../../lib/d10-pose.js'),
          import('../../lib/d10-physics.js'),
        ]);
        if (cancelled) return;

        const width = element.clientWidth || 480;
        const renderer = new T.WebGLRenderer({ alpha: true, antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        renderer.setSize(width, 260);
        renderer.toneMapping = T.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.65;
        element.appendChild(renderer.domElement);

        const scene = new T.Scene();
        const camera = new T.PerspectiveCamera(38, width / 260, 0.1, 100);
        camera.position.set(0, -1.2, 15);
        camera.lookAt(0, 0, 0);
        const pmrem = new T.PMREMGenerator(renderer);
        const room = new RoomEnvironment();
        const environment = pmrem.fromScene(room);
        room.dispose();
        pmrem.dispose();
        scene.environment = environment.texture;

        scene.add(new T.HemisphereLight(0xddd2ff, 0x21102f, 2));
        const light = new T.DirectionalLight(0xffe5b0, 4);
        light.position.set(-3, 5, 6);
        light.castShadow = true;
        light.shadow.mapSize.set(512, 512);
        scene.add(light);

        const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
          const nextWidth = element.clientWidth || 480;
          renderer.setSize(nextWidth, 260);
          camera.aspect = nextWidth / 260;
          camera.updateProjectionMatrix();
          if (!document.hidden) renderer.render(scene, camera);
        });
        resize?.observe(element);

        const geometries = new Set<BufferGeometry>();
        const materials = new Set<Material>();
        const textures = new Set<Texture>();
        const collect = (object: Object3D) => object.traverse((node) => {
          if (!(node instanceof T.Mesh)) return;
          geometries.add(node.geometry);
          for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
            materials.add(material);
            for (const value of Object.values(material)) {
              if (value instanceof T.Texture) textures.add(value);
            }
          }
        });
        teardown = () => {
          resize?.disconnect();
          window.cancelAnimationFrame(frame);
          if (visibilityListener) document.removeEventListener('visibilitychange', visibilityListener);
          geometries.forEach((geometry) => geometry.dispose());
          materials.forEach((material) => material.dispose());
          textures.forEach((texture) => texture.dispose());
          environment.dispose();
          renderer.dispose();
          renderer.domElement.remove();
        };

        const gltf = display.faces === 6
          ? { scene: new T.Group() }
          : await new GLTFLoader().loadAsync(modelUrl);
        if (display.faces === 6) {
          const faceMaterials = D6_VALUES.map((value) => {
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 256;
            const context = canvas.getContext('2d');
            if (!context) throw new Error('Canvas 2D context unavailable');
            context.fillStyle = '#f4f0e8';
            context.fillRect(0, 0, 256, 256);
            context.strokeStyle = '#899b87';
            context.lineWidth = 5;
            context.strokeRect(10, 10, 236, 236);
            context.fillStyle = '#292820';
            context.font = 'bold 150px Georgia';
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.fillText(String(value), 128, 138);
            const texture = new T.CanvasTexture(canvas);
            texture.colorSpace = T.SRGBColorSpace;
            return new T.MeshStandardMaterial({ map: texture, roughness: 0.65 });
          });
          gltf.scene.add(new T.Mesh(new T.BoxGeometry(1.6, 1.6, 1.6), faceMaterials));
        }
        collect(gltf.scene);
        if (cancelled) {
          teardown();
          return;
        }

        const size = new T.Box3().setFromObject(gltf.scene).getSize(new T.Vector3());
        const scale = display.faces === 6 ? 1 : 2.7 / Math.max(size.x, size.y, size.z);
        const objects = display.digits.map((digit, index) => {
          const pivot = new T.Group();
          const mesh = gltf.scene.clone(true);
          mesh.scale.multiplyScalar(scale);
          pivot.add(mesh);
          scene.add(pivot);
          return {
            pivot,
            target: display.faces === 6 ? d6Landing(digit) : d10Landing(digit),
            x: display.digits.length === 2 ? (index === 0 ? -1.65 : 1.65) : 0,
          };
        });
        objects.forEach(({ pivot }) => pivot.traverse((node) => {
          if (node instanceof T.Mesh) node.castShadow = true;
        }));

        // Procedural tray avoids an unregistered external texture dependency.
        const outline = new T.Shape();
        outline.moveTo(-4.1, -2.2);
        outline.lineTo(4.1, -2.2);
        outline.quadraticCurveTo(4.5, -2.2, 4.5, -1.8);
        outline.lineTo(4.5, 1.8);
        outline.quadraticCurveTo(4.5, 2.2, 4.1, 2.2);
        outline.lineTo(-4.1, 2.2);
        outline.quadraticCurveTo(-4.5, 2.2, -4.5, 1.8);
        outline.lineTo(-4.5, -1.8);
        outline.quadraticCurveTo(-4.5, -2.2, -4.1, -2.2);
        // Brown felt box: a procedural nap (no external texture file) on an
        // opaque floor and walls, so the dice land in a tray, not on a white card.
        const feltCanvas = document.createElement('canvas');
        feltCanvas.width = 256;
        feltCanvas.height = 256;
        const felt2d = feltCanvas.getContext('2d');
        if (felt2d) {
          felt2d.fillStyle = '#6b4a35';
          felt2d.fillRect(0, 0, 256, 256);
          for (let fibre = 0; fibre < 9000; fibre += 1) {
            const angle = Math.random() * Math.PI;
            const length = 1 + Math.random() * 3;
            felt2d.fillStyle = Math.random() < 0.5
              ? `rgba(214, 170, 120, ${0.05 + Math.random() * 0.08})`
              : `rgba(40, 24, 14, ${0.06 + Math.random() * 0.1})`;
            felt2d.fillRect(Math.random() * 256, Math.random() * 256, Math.cos(angle) * length + 1, Math.sin(angle) * length + 1);
          }
        }
        const nap = new T.CanvasTexture(feltCanvas);
        nap.colorSpace = T.SRGBColorSpace;
        nap.wrapS = nap.wrapT = T.RepeatWrapping;
        nap.repeat.set(3, 1.5);
        const velvet = new T.MeshPhysicalMaterial({
          color: 0xffffff,
          map: nap,
          bumpMap: nap,
          bumpScale: 0.02,
          roughness: 1,
          sheen: 1,
          sheenColor: new T.Color(0xa0714d),
          sheenRoughness: 0.85,
          side: T.DoubleSide,
        });
        const floor = new T.Mesh(new T.ShapeGeometry(outline), velvet);
        floor.position.z = -0.025;
        floor.receiveShadow = true;
        scene.add(floor);
        collect(floor);
        const edge = outline.getPoints(12);
        const railPositions: number[] = [];
        const railIndices: number[] = [];
        edge.forEach((point) => railPositions.push(point.x, point.y, 0, point.x * 1.06, point.y * 1.12, 1.3));
        for (let index = 0; index < edge.length - 1; index += 1) {
          const offset = index * 2;
          railIndices.push(offset, offset + 2, offset + 1, offset + 1, offset + 2, offset + 3);
        }
        const railGeometry = new T.BufferGeometry();
        railGeometry.setAttribute('position', new T.Float32BufferAttribute(railPositions, 3));
        railGeometry.setIndex(railIndices);
        railGeometry.computeVertexNormals();
        // The felt walls stay visible in the ceremony card too: they make the box.
        const rails = new T.Mesh(railGeometry, velvet.clone());
        scene.add(rails);
        collect(rails);

        let trajectory: D10Trajectory | undefined;
        if (rolls && !still && !settledAtMount) {
          trajectory = await simulateD10Throw(display.digits, undefined, () => cancelled, display.faces);
        }
        // Timed out while loading: the numeric result is already showing.
        if (cancelled || finished) {
          teardown();
          return;
        }
        window.clearTimeout(watchdog);

        const started = performance.now();
        const duration = trajectory ? (trajectory.length - 1) / 60 * 1000 : 180;
        const tick = (now: number) => {
          frame = 0;
          if (cancelled || document.hidden) return;
          const progress = settledAtMount || !rolls ? 1 : Math.max(0, Math.min(1, (now - started) / duration));
          objects.forEach(({ pivot, target, x }, index) => {
            if (trajectory && progress < 1) {
              const at = progress * (trajectory.length - 1);
              const lower = Math.floor(at);
              const upper = Math.min(lower + 1, trajectory.length - 1);
              const a = trajectory[lower][index];
              const b = trajectory[upper][index];
              pivot.position.fromArray(a.position).lerp(new T.Vector3(...b.position), at - lower);
              pivot.quaternion.fromArray(a.rotation).slerp(new T.Quaternion(...b.rotation), at - lower);
            } else {
              pivot.position.set(x, 0, 1);
              pivot.quaternion.copy(target);
            }
          });
          renderer.render(scene, camera);
          if (progress < 1) frame = window.requestAnimationFrame(tick);
          else complete();
        };
        const onVisibility = () => {
          if (document.hidden) {
            if (frame) window.cancelAnimationFrame(frame);
            frame = 0;
          } else if (!frame && !cancelled) {
            frame = window.requestAnimationFrame(tick);
          }
        };
        visibilityListener = onVisibility;
        document.addEventListener('visibilitychange', onVisibility);
        if (!document.hidden) frame = window.requestAnimationFrame(tick);
      } catch (error) {
        if (cancelled) return;
        console.warn('D10 rendering unavailable; showing the authoritative numeric result.', error);
        teardown();
        window.clearTimeout(watchdog);
        setFallback(true);
        complete();
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(watchdog);
      teardown();
    };
  }, [key, still, integrated, diceRendering]);

  const reading = display?.reading || rolls?.join(' · ') || 'Result unavailable';
  const numericFallback = fallback || still || diceRendering === 'numeric';
  return (
    <div className="d10-stage" role="group" aria-label={`${dice} dice display`}>
      <div ref={host} className="d10-stage__canvas" aria-hidden="true" style={{ display: numericFallback ? 'none' : undefined }} />
      {numericFallback && <div className="d10-stage__fallback" role="status" aria-live="polite">{reading}</div>}
      <div className="d10-stage__labels">
        {(display?.labels ?? [dice]).map((label, index) => (
          <span key={index}>{label}{settled && display ? ` · ${display.digits[index]}` : ''}</span>
        ))}
      </div>
      {settled && display && <output className="d10-stage__reading" aria-label={`Result ${display.reading}`}>{display.reading}</output>}
      <span className="d10-stage__sr-status" role="status" aria-live="polite">
        {settled ? `Result: ${reading}` : `${dice} rolling`}
      </span>
    </div>
  );
}
