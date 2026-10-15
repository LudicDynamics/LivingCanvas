import React, { useEffect, useState } from 'react';
import { Canvas } from './Canvas.js';
import type { LayerItem, LayerLink } from '../../state/useWorld.js';
import { whenFontsSettled } from '../../lib/fonts.js';
import { airpGateway } from '../../lib/airp-gateway.js';

/**
 * Read-only perception surface for server-side Playwright captures
 *: the SAME Canvas component tree, but every side effect
 * is off — no WebSocket, no footprint measurement posts, no viewpoint writes,
 * no drag/choices/audio. The page exposes the capture contract via datasets:
 * `data-airp-canvas-surface` (screenshot root) and, once items are rendered,
 * fonts settled and at least one frame has painted, `html[data-airp-canvas-ready="1"]`
 * with `data-airp-canvas-layer` / `data-airp-canvas-snapshot` identity. Any
 * load failure sets `html[data-airp-canvas-error]` instead — a capture must
 * never photograph a loading or broken page.
 */

interface PerceptionLayerResponse {
  items: LayerItem[];
  links: LayerLink[];
  bg?: { src: string | null; tone: string; grain: string };
}

function perceptionAssetUrl(assetPath?: string): string | undefined {
  if (!assetPath) return undefined;
  if (/^(?:https?:|data:|blob:)/.test(assetPath)) return assetPath;
  return airpGateway.assetUrl(assetPath.replace(/^\/+/, ''), undefined, 'image');
}

export function PerceptionRoot({ layer, snapshotId }: { layer: string; snapshotId: string }): React.ReactElement {
  const [state, setState] = useState<PerceptionLayerResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/layer?layer=${encodeURIComponent(layer)}&readOnly=1`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<PerceptionLayerResponse>;
      })
      .then((data) => {
        if (!cancelled) setState(data);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'layer fetch failed');
      });
    return () => { cancelled = true; };
  }, [layer]);

  // Capture-ready signal: items landed, fonts settled, ≥1 painted frame.
  useEffect(() => {
    if (!state) return;
    let cancelled = false;
    void whenFontsSettled().then(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        const root = document.documentElement;
        root.dataset.airpCanvasLayer = layer;
        root.dataset.airpCanvasSnapshot = snapshotId;
        root.dataset.airpCanvasReady = '1';
      });
    });
    return () => { cancelled = true; };
  }, [state, layer, snapshotId]);

  useEffect(() => {
    const root = document.documentElement;
    if (error) root.dataset.airpCanvasError = error;
    return () => { delete root.dataset.airpCanvasError; };
  }, [error]);

  if (error || !state) {
    return <div style={{ position: 'fixed', inset: 0, background: '#efe7d8' }} />;
  }

  return (
    <div
      data-airp-canvas-surface
      style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: '#efe7d8' }}
    >
      <Canvas
        currentLayer={layer}
        items={state.items}
        links={state.links ?? []}
        bg={state.bg ?? { src: null, tone: 'warm', grain: 'parchment' }}
        assetUrl={perceptionAssetUrl}
      />
    </div>
  );
}
