/**
 * Board — map mode's stage.
 *
 * Draws `lib/board-model.ts`'s board for the current layer as a 2D map at 45°:
 * the floor as diamond tiles, the layer's child places as buildings / doors /
 * drawers standing on it, characters as tokens, objects as small pieces, and
 * the way out at the edge. It replaces the chalk canvas while map mode is on;
 * the layer's data is exactly the canvas's, only drawn as a place.
 *
 * Every click goes through the SAME actions the canvas and the rail use —
 * entering a place is `enterGate`, meeting someone is `meetCharacter`, picking
 * something up is `handleTakeItem` — so map mode adds a view, not a second way
 * to play.
 *
 * The 45° is the projection in `lib/camera.ts` (`projectOffset`, `MAP_FLOOR`),
 * applied here to the board's own tiles — never to the chalk cards.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useLocale } from '../../lib/i18n.js';
import { projectOffset } from '../../lib/camera.js';
import { buildBoard, mapPlan, type Board as BoardData, type BoardInput, type BoardPiece } from '../../lib/board-model.js';
import type { FocusCoordinator } from '../../lib/focus-coordinator.js';
import { PictureMap } from './PictureMap.js';
import { MapCardPanel, type MapCardItem } from './MapCardPanel.js';
import './board.css';

/** One tile's edge in board units, before projection. */
const TILE = 60;

/** How tall each kind of thing stands, in board units. */
const PLACE_HEIGHT: Record<BoardData['kind'], number> = { region: 54, town: 72, interior: 58, detail: 22 };

type Point = { x: number; y: number };

/** A tile-space point (gx, gy) on the floor, projected to the screen. */
function floor(gx: number, gy: number, size: number): Point {
  const half = (size * TILE) / 2;
  return projectOffset(gx * TILE - half, gy * TILE - half, 'map');
}

const pointsOf = (points: Point[]) => points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

/** The four floor corners of a footprint, back → right → front → left. */
function footprint(piece: { gx: number; gy: number; w: number; h: number }, size: number): Point[] {
  return [
    floor(piece.gx, piece.gy, size),
    floor(piece.gx + piece.w, piece.gy, size),
    floor(piece.gx + piece.w, piece.gy + piece.h, size),
    floor(piece.gx, piece.gy + piece.h, size),
  ];
}

const raise = (point: Point, by: number): Point => ({ x: point.x, y: point.y - by });

/** An upright box on a footprint: two visible sides and a lid. */
function Block({ corners, height, className }: { corners: Point[]; height: number; className: string }) {
  const [, right, front, left] = corners;
  const top = corners.map(point => raise(point, height));
  return (
    <g className={className}>
      <polygon className="board-block__side board-block__side--left" points={pointsOf([left, front, raise(front, height), raise(left, height)])} />
      <polygon className="board-block__side board-block__side--right" points={pointsOf([front, right, raise(right, height), raise(front, height)])} />
      <polygon className="board-block__lid" points={pointsOf(top)} />
    </g>
  );
}

const ITEM_GLYPH: Record<string, string> = { letter: '✉', note: '📜', prop: '◆', photo: '▣', image: '▣' };

export interface BoardProps extends Omit<BoardInput, 'items'> {
  items: BoardInput['items'];
  /**
   * This layer's picture (already a URL). When there is one, the map IS that
   * picture with the places pinned on it; the tiled board is only for a layer
   * with no picture at all.
   */
  image?: string | null;
  /** Paths the player carries; a door asking for something else is drawn locked. */
  carried: ReadonlySet<string>;
  onEnterPlace(target: string): void;
  onMeetCharacter(id: string): void;
  onTakeItem(path: string): void;
  onLeave(parentId: string): void;
  /** World-relative asset path → URL; lets a planned map (`map.plan`) be shown. */
  resolveAsset?(path: string): string | null;
  /** The companion panel is open on the right: keep the picture out from under it. */
  clearCompanion?: boolean;
  /** A card's declared action / writer prompt — the canvas's `onEntityAction`. */
  onEntityAction?(prompt: string): void;
  /** The shell's focus coordinator, so an opened card behaves like the canvas's. */
  focus?: FocusCoordinator;
}

export function Board(props: BoardProps): React.ReactElement {
  // A drawn map wins over the scene picture — but only once it has actually
  // loaded. Until someone generates it the file is simply not there, and the
  // layer keeps its scene picture and that picture's own pins.
  const plan = useMemo(() => mapPlan(props.readme), [props.readme]);
  const planUrl = plan && props.resolveAsset ? props.resolveAsset(plan.picture) : null;
  const [planReady, setPlanReady] = useState<string | null>(null);
  useEffect(() => {
    setPlanReady(null);
    if (!planUrl) return;
    let live = true;
    const probe = new Image();
    probe.onload = () => { if (live) setPlanReady(planUrl); };
    probe.src = planUrl;
    return () => { live = false; };
  }, [planUrl]);
  if (plan && planReady) return <PictureMap {...props} readme={plan.readme} image={planReady} />;
  return props.image ? <PictureMap {...props} image={props.image} /> : <TiledBoard {...props} />;
}

/** The procedural board: only for a layer that has no picture. */
function TiledBoard(props: BoardProps): React.ReactElement {
  const { t } = useLocale();
  const { worldId, layerId, readme, items, characters, parent, carried } = props;
  const board = useMemo(
    () => buildBoard({ worldId, layerId, readme, items, characters, parent }, carried),
    [worldId, layerId, readme, items, characters, parent, carried],
  );
  const [openItem, setOpenItem] = useState<string | null>(null);

  // Frame: the projected floor plus headroom for what stands on its back row.
  const corners = [floor(0, 0, board.size), floor(board.size, 0, board.size), floor(board.size, board.size, board.size), floor(0, board.size, board.size)];
  const minX = Math.min(...corners.map(p => p.x)) - TILE;
  const maxX = Math.max(...corners.map(p => p.x)) + TILE;
  const minY = Math.min(...corners.map(p => p.y)) - PLACE_HEIGHT[board.kind] - TILE * 1.5;
  const maxY = Math.max(...corners.map(p => p.y)) + TILE;

  // Painter's order: what is further back is drawn first.
  const ordered = [...board.pieces].sort((a, b) => (a.gx + a.w / 2 + a.gy + a.h / 2) - (b.gx + b.w / 2 + b.gy + b.h / 2));
  const centre = floor(board.size / 2, board.size / 2, board.size);
  const item = openItem ? items.find(entry => entry.path === openItem) : undefined;

  const activate = (piece: BoardPiece) => {
    if (piece.kind === 'place') props.onEnterPlace(piece.ref);
    else if (piece.kind === 'character') props.onMeetCharacter(piece.ref);
    else if (piece.kind === 'item') setOpenItem(piece.ref);
    else if (piece.kind === 'exit') props.onLeave(piece.ref);
  };
  const buttonProps = (piece: BoardPiece, label: string) => ({
    role: 'button',
    tabIndex: 0,
    'aria-label': label,
    onClick: () => activate(piece),
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(piece); }
    },
  });

  return (
    <div className="board" data-board-kind={board.kind}>
      {board.narration && <p className="board__narration">{board.narration}</p>}
      <svg
        className="board__svg"
        viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
        preserveAspectRatio="xMidYMid meet"
        aria-label={t('Map')}
      >
        <g className="board__floor">
          {board.tiles.map((tile, index) => {
            const gx = index % board.size;
            const gy = Math.floor(index / board.size);
            return <polygon key={index} className={`board-tile board-tile--${tile}`} points={pointsOf(footprint({ gx, gy, w: 1, h: 1 }, board.size))} />;
          })}
        </g>

        {/* A region's places are joined by roads to its heart. */}
        {board.kind === 'region' && (
          <g className="board__roads">
            {board.pieces.filter(piece => piece.kind === 'place').map(piece => {
              const at = floor(piece.gx + piece.w / 2, piece.gy + piece.h / 2, board.size);
              return <line key={piece.id} x1={at.x} y1={at.y} x2={centre.x} y2={centre.y} />;
            })}
          </g>
        )}

        {ordered.map(piece => {
          const base = footprint(piece, board.size);
          const foot = floor(piece.gx + piece.w / 2, piece.gy + piece.h / 2, board.size);
          if (piece.kind === 'place') {
            const height = PLACE_HEIGHT[board.kind];
            const label = piece.locked ? `${piece.label} · ${t('Locked')}` : piece.label;
            return (
              <g key={piece.id} className={`board-piece board-place${piece.locked ? ' is-locked' : ''}`} {...buttonProps(piece, label)}>
                <Block corners={base} height={height} className={`board-block board-block--${board.kind}`} />
                <text className="board-label" x={foot.x} y={foot.y - height - 12}>{piece.locked ? '🔒 ' : ''}{piece.label}</text>
              </g>
            );
          }
          if (piece.kind === 'item') {
            return (
              <g key={piece.id} className="board-piece board-item" {...buttonProps(piece, piece.label)}>
                <ellipse className="board-shadow" cx={foot.x} cy={foot.y} rx={16} ry={7} />
                <circle className="board-item__disc" cx={foot.x} cy={foot.y - 18} r={15} />
                <text className="board-item__glyph" x={foot.x} y={foot.y - 13}>{ITEM_GLYPH[piece.itemType ?? ''] ?? '◆'}</text>
                <text className="board-label board-label--small" x={foot.x} y={foot.y - 40}>{piece.label}</text>
              </g>
            );
          }
          if (piece.kind === 'character') {
            const clip = `board-clip-${piece.id}`;
            return (
              <g key={piece.id} className="board-piece board-character" {...buttonProps(piece, piece.label)}>
                <ellipse className="board-shadow" cx={foot.x} cy={foot.y} rx={22} ry={9} />
                <clipPath id={clip}><circle cx={foot.x} cy={foot.y - 34} r={24} /></clipPath>
                <circle className="board-character__ring" cx={foot.x} cy={foot.y - 34} r={26} />
                {piece.avatar
                  ? <image href={piece.avatar} x={foot.x - 24} y={foot.y - 58} width={48} height={48} clipPath={`url(#${clip})`} preserveAspectRatio="xMidYMin slice" />
                  : <text className="board-character__initial" x={foot.x} y={foot.y - 27}>{piece.label.charAt(0)}</text>}
                <text className="board-label" x={foot.x} y={foot.y - 68}>{piece.label}</text>
              </g>
            );
          }
          if (piece.kind === 'player') {
            return (
              <g key={piece.id} className="board-piece board-player" aria-hidden="true">
                <ellipse className="board-player__ring" cx={foot.x} cy={foot.y} rx={20} ry={9} />
                <text className="board-label board-label--small" x={foot.x} y={foot.y - 14}>{t('You')}</text>
              </g>
            );
          }
          // exit
          return (
            <g key={piece.id} className="board-piece board-exit" {...buttonProps(piece, t('Back to {place}', { place: piece.label }))}>
              <ellipse className="board-exit__mark" cx={foot.x} cy={foot.y} rx={30} ry={13} />
              <text className="board-label" x={foot.x} y={foot.y + 5}>↩ {piece.label}</text>
            </g>
          );
        })}
      </svg>

      {item && (
        <MapCardPanel
          className="board__item map-card"
          item={item as MapCardItem}
          focus={props.focus}
          onClose={() => setOpenItem(null)}
          onEntityAction={props.onEntityAction}
          onEnterPlace={props.onEnterPlace}
          onMeetCharacter={props.onMeetCharacter}
        />
      )}
    </div>
  );
}
