import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { getParallax } from '../../lib/parallax.js';
import type { PerformanceSettings } from '../../lib/performance-settings.js';

export interface ParticleLayerProps {
  tone?: string;
  /** Keep the existing ambient switch compatible with Canvas callers. */
  ambient?: boolean;
  /** Shared lifecycle gate for both particle surfaces. */
  effectsEnabled?: boolean;
  particleDensity: PerformanceSettings['particleDensity'];
  hidden?: boolean;
  reducedMotion?: boolean;
}

export interface ParticleLifecycle {
  effectsEnabled: boolean;
  hidden: boolean;
  reducedMotion: boolean;
}

interface Particle {
  x: number;
  y: number;
  baseX: number;
  baseY: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  maxAlpha: number;
  pulseSpeed: number;
  pulseOffset: number;
  wobbleSpeed: number;
  wobbleRadius: number;
}

/** Source bitmap edge in pixels; no device-pixel-ratio scaling is applied. */
const GLOW_SPRITE_PX = 64;

/** One glow bitmap avoids allocating gradient objects per mote and frame. */
function makeGlowSprite(): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = GLOW_SPRITE_PX;
  const context = canvas.getContext('2d');
  if (!context) {
    canvas.width = canvas.height = 0;
    return null;
  }
  const radius = GLOW_SPRITE_PX / 2;
  const gradient = context.createRadialGradient(radius, radius, 0, radius, radius, radius);
  gradient.addColorStop(0, 'rgba(235, 205, 140, 1)');
  gradient.addColorStop(0.5, 'rgba(215, 160, 90, 0.5)');
  gradient.addColorStop(1, 'rgba(215, 160, 90, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, GLOW_SPRITE_PX, GLOW_SPRITE_PX);
  return canvas;
}


/**
 * Ambient and burst are separate observable surfaces in one module. Bursts
 * use bounded DOM sprites rather than another full-screen canvas, while the
 * ambient canvas keeps the existing low-frequency drawing budget.
 */
interface BurstGroup {
  particles: BurstParticle[];
  color: string;
  startedAt: number;
  durationMs: number;
  seeded: boolean;
  nodes: HTMLSpanElement[];
}

interface BurstParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
}

export interface BurstSpec {
  color?: string;
  bursts?: number;
  origin?: string;
  durationMs: number;
}

/** Particles per cluster — 8 clusters × 12 = the frozen 96-particle ceiling. */
const BURST_PER_CLUSTER = 12;

function parseOrigin(origin?: string): { x: number; y: number } {
  const m = (origin ?? '').split(',');
  if (m.length !== 2) return { x: 0.5, y: 0.2 };
  const x = Number(m[0]);
  const y = Number(m[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
    return { x: 0.5, y: 0.2 };
  }
  return { x, y };
}

let burstGroups: BurstGroup[] = [];
let burstLifecycle: ParticleLifecycle = {
  effectsEnabled: false,
  hidden: true,
  reducedMotion: false,
};
let wakeParticleLoop: (() => void) | null = null;
let burstHost: HTMLElement | null = null;

function removeBurstNodes(group: BurstGroup): void {
  for (const node of group.nodes) node.remove();
  group.nodes = [];
}

function mountBurstNodes(group: BurstGroup, host: HTMLElement): void {
  if (group.nodes.length || typeof document === 'undefined') return;
  for (const particle of group.particles) {
    const node = document.createElement('span');
    node.setAttribute('aria-hidden', 'true');
    node.style.position = 'absolute';
    node.style.borderRadius = '50%';
    node.style.pointerEvents = 'none';
    node.style.background = `radial-gradient(circle, ${group.color} 0 35%, transparent 72%)`;
    node.style.willChange = 'transform, opacity';
    host.appendChild(node);
    group.nodes.push(node);
    // The bounded surface owns the origin; animation supplies pixel transforms.
    node.style.left = '0px';
    node.style.top = '0px';
  }
}

/**
 * Play one fireworks burst. The optional host keeps existing callers working;
 * a mounted ParticleLayer registers its bounded burst surface automatically.
 */
export function playBurst(spec: BurstSpec, host?: HTMLElement): () => void {
  if (
    burstLifecycle.hidden ||
    !burstLifecycle.effectsEnabled ||
    burstLifecycle.reducedMotion
  ) {
    return () => {};
  }

  const color = typeof spec.color === 'string' && spec.color ? spec.color : 'rgb(235, 205, 140)';
  const clusters = Math.max(1, Math.min(8, Math.floor(spec.bursts ?? 5)));
  const durationMs = Number.isFinite(spec.durationMs) ? Math.max(0, spec.durationMs) : 3000;
  const origin = parseOrigin(spec.origin);
  const particles: BurstParticle[] = [];

  for (let c = 0; c < clusters; c++) {
    const ox = origin.x + (Math.random() - 0.5) * 0.18;
    const oy = origin.y + (Math.random() - 0.5) * 0.12;
    for (let i = 0; i < BURST_PER_CLUSTER; i++) {
      const angle = (i / BURST_PER_CLUSTER) * Math.PI * 2 + Math.random() * 0.4;
      const speed = 1.4 + Math.random() * 3.6;
      particles.push({
        x: ox,
        y: oy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 3 + Math.random() * 4,
      });
    }
  }

  const group: BurstGroup = {
    particles,
    color,
    startedAt: performance.now(),
    durationMs,
    seeded: false,
    nodes: [],
  };
  burstGroups = [group]; // latest intent takes the fireworks resource lane
  const surface = host ?? burstHost;
  if (surface) mountBurstNodes(group, surface);
  wakeParticleLoop?.();

  return () => {
    removeBurstNodes(group);
    burstGroups = burstGroups.filter((g) => g !== group);
  };
}

export const ParticleLayer: React.FC<ParticleLayerProps> = ({
  tone = 'warm',
  ambient = true,
  effectsEnabled = true,
  particleDensity,
  hidden = false,
  reducedMotion = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const burstRef = useRef<HTMLDivElement | null>(null);
  const [documentHidden, setDocumentHidden] = React.useState(
    typeof document !== 'undefined' && document.hidden
  );
  const active = effectsEnabled && !hidden && !reducedMotion && !documentHidden;
  useLayoutEffect(() => {
    burstLifecycle = { effectsEnabled, hidden: hidden || documentHidden, reducedMotion };
  }, [effectsEnabled, hidden, reducedMotion, documentHidden]);
  const toneRef = useRef(tone);
  toneRef.current = tone;

  useEffect(() => {
    if (!effectsEnabled) return;
    const onVisibility = () => setDocumentHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [effectsEnabled]);

  useEffect(() => {
    if (!active) {
      burstLifecycle = { effectsEnabled: false, hidden: true, reducedMotion };
      for (const group of burstGroups) removeBurstNodes(group);
      burstGroups = [];
      return;
    }
    const burstSurface = burstRef.current;
    if (!burstSurface) return;
    const canvas = ambient ? canvasRef.current : null;
    const ctx = canvas?.getContext('2d') ?? null;
    let glowSprite: HTMLCanvasElement | null = null;
    if (ctx && ambient) glowSprite = makeGlowSprite();

    burstHost = burstSurface;
    burstLifecycle = { effectsEnabled, hidden: false, reducedMotion: false };
    let animId = 0;
    let width = window.innerWidth;
    let height = window.innerHeight;
    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      if (!canvas || !ctx) return;
      const scale = Math.min(1, 1600 / Math.max(1, width), 1000 / Math.max(1, height));
      canvas.width = Math.max(1, Math.floor(width * scale));
      canvas.height = Math.max(1, Math.floor(height * scale));
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
    };
    if (ambient && ctx) {
      resize();
      window.addEventListener('resize', resize);
    }

    const isRain = toneRef.current.includes('rain');
    const particles: Particle[] = [];
    if (ambient && ctx && (isRain || glowSprite)) {
      const count = particleDensity === 'reduced' ? 16 : 48;
      for (let i = 0; i < count; i++) {
        particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          baseX: Math.random() * width,
          baseY: Math.random() * height,
          vx: isRain ? -1.5 - Math.random() * 2 : (Math.random() - 0.5) * 0.4,
          vy: isRain ? 9 + Math.random() * 8 : -0.2 - Math.random() * 0.4,
          size: isRain ? 12 + Math.random() * 14 : 1.2 + Math.random() * 2.4,
          alpha: Math.random() * 0.5 + 0.1,
          maxAlpha: isRain ? 0.35 : 0.55 + Math.random() * 0.3,
          pulseSpeed: 0.015 + Math.random() * 0.02,
          pulseOffset: Math.random() * Math.PI * 2,
          wobbleSpeed: 0.01 + Math.random() * 0.02,
          wobbleRadius: 8 + Math.random() * 16,
        });
      }
    }

    const FRAME_MS = 1000 / 30;
    let time = 0;
    let lastDraw = 0;
    const isPaused = () => {
      const state = burstLifecycle;
      return document.hidden || !state.effectsEnabled || state.hidden || state.reducedMotion;
    };
    const hasWork = () => (ambient && !!ctx && (toneRef.current.includes('rain') || !!glowSprite)) || burstGroups.length > 0;
    const stop = () => {
      if (animId) cancelAnimationFrame(animId);
      animId = 0;
    };
    const schedule = () => {
      if (!animId && !isPaused() && hasWork()) animId = requestAnimationFrame(render);
    };
    const render = (now: number) => {
      animId = 0;
      if (isPaused() || !hasWork()) return;
      if (now - lastDraw < FRAME_MS) {
        schedule();
        return;
      }
      lastDraw = now;
      time += 1;
      ctx?.clearRect(0, 0, width, height);
      const p = getParallax();
      const shiftX = -p.x * 24;
      const shiftY = -p.y * 24;
      if (ambient && ctx) {
        const isRain = toneRef.current.includes('rain');
        for (const part of particles) {
          if (isRain) {
            part.x += part.vx;
            part.y += part.vy;
            if (part.y > height) {
              part.y = -20;
              part.x = Math.random() * (width + 100);
            }
            if (part.x < -20) part.x = width + 20;
            const drawX = part.x + shiftX;
            const drawY = part.y + shiftY;
            ctx.beginPath();
            ctx.strokeStyle = `rgba(180, 205, 225, ${part.alpha * 0.4})`;
            ctx.lineWidth = 1.2;
            ctx.moveTo(drawX, drawY);
            ctx.lineTo(drawX + part.vx * 3, drawY + part.vy * 3);
            ctx.stroke();
          } else if (glowSprite) {
            part.baseY += part.vy;
            if (part.baseY < -20) {
              part.baseY = height + 20;
              part.baseX = Math.random() * width;
            }
            const wobble = Math.sin(time * part.wobbleSpeed + part.pulseOffset) * part.wobbleRadius;
            const alpha = (Math.sin(time * part.pulseSpeed + part.pulseOffset) * 0.5 + 0.5) * part.maxAlpha;
            const d = part.size * 4.4;
            ctx.globalAlpha = alpha;
            ctx.drawImage(glowSprite, part.baseX + wobble + shiftX - d / 2, part.baseY + shiftY - d / 2, d, d);
          }
        }
      }
      for (const group of burstGroups) {
        mountBurstNodes(group, burstSurface);
        const age = now - group.startedAt;
        const fade = Math.max(0, 1 - age / Math.max(1, group.durationMs));
        for (let i = 0; i < group.particles.length; i++) {
          const bp = group.particles[i];
          if (!group.seeded) {
            bp.x *= width;
            bp.y *= height;
          }
          bp.x += bp.vx;
          bp.y += bp.vy + 0.06;
          const d = bp.size * 3;
          const node = group.nodes[i];
          if (!node) continue;
          node.style.width = `${d}px`;
          node.style.height = `${d}px`;
          node.style.opacity = String(fade);
          node.style.transform = `translate3d(${bp.x + shiftX - d / 2}px, ${bp.y + shiftY - d / 2}px, 0)`;
        }
        group.seeded = true;
        if (age >= group.durationMs) removeBurstNodes(group);
      }
      burstGroups = burstGroups.filter((group) => now - group.startedAt < group.durationMs);
      if (ctx) ctx.globalAlpha = 1;
      schedule();
    };
    const onVisibility = () => {
      if (isPaused()) stop();
      else schedule();
    };
    wakeParticleLoop = schedule;
    document.addEventListener('visibilitychange', onVisibility);
    for (const group of burstGroups) mountBurstNodes(group, burstSurface);
    schedule();

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      if (ambient && ctx) window.removeEventListener('resize', resize);
      if (wakeParticleLoop === schedule) wakeParticleLoop = null;
      if (burstHost === burstSurface) burstHost = null;
      for (const group of burstGroups) removeBurstNodes(group);
      burstGroups = [];
      if (canvas) canvas.width = canvas.height = 0;
      glowSprite = null;
      burstLifecycle = { effectsEnabled: false, hidden: true, reducedMotion: false };
    };
  }, [active, ambient, particleDensity, effectsEnabled, hidden, reducedMotion]);

  if (!active) return null;
  return (
    <div className="absolute inset-0 pointer-events-none" data-particle-module="true">
      {ambient && (
        <canvas
          ref={canvasRef}
          className="particle-surface particle-surface--ambient absolute inset-0 pointer-events-none z-10 w-full h-full"
          data-particle-surface="ambient"
          data-depth="background"
          aria-hidden="true"
        />
      )}
      <div
        ref={burstRef}
        className="particle-surface particle-surface--burst absolute inset-0 pointer-events-none overflow-hidden z-20"
        data-particle-surface="burst"
        data-depth="performance"
      />
    </div>
  );
};
