/**
 * The player's clue board for the current page.
 *
 * The board is a separate read from the layer (`GET /api/player-board`): the
 * writer's links and cards stay exactly what `/api/layer` says, and the
 * player's lines and marks are drawn on top. Kept current by
 *   - the answer of every write this tab makes,
 *   - the `player_board` frame (relayed by useWorld as `airp:player-board`),
 *   - a refetch when the page changes or a note is deleted elsewhere.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { airpGateway, type PlayerBoardView, type PlayerNoteRequest, type PlayerTagValue } from '../lib/airp-gateway.js';
import type { LayerLink } from './useWorld.js';

const EMPTY: PlayerBoardView = { links: [], tags: {} };

/** The style LinkLayer paints a player's line with (red thread + label). */
export const CLUE_LINK_STYLE = 'clue';

export interface PlayerBoardApi {
  board: PlayerBoardView;
  /** The player's lines, shaped like the writer's so LinkLayer draws both. */
  links: LayerLink[];
  tags: ReadonlyMap<string, PlayerTagValue>;
  link(from: string, to: string, label?: string): Promise<void>;
  unlink(id: string): Promise<void>;
  tag(path: string, tag: PlayerTagValue | null): Promise<void>;
  note(body: PlayerNoteRequest): Promise<{ path: string } | null>;
}

export function usePlayerBoard(layer: string | null, onError: (message: string) => void, onNotesChanged?: () => void): PlayerBoardApi {
  const [board, setBoard] = useState<PlayerBoardView>(EMPTY);
  const layerRef = useRef(layer);
  layerRef.current = layer;
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const changedRef = useRef(onNotesChanged);
  changedRef.current = onNotesChanged;

  const fetchBoard = useCallback(async (target: string) => {
    try {
      const result = await airpGateway.playerBoard(target);
      if (layerRef.current === target) setBoard(result.board);
    } catch {
      // No active world / old server: no board, never an error toast.
      if (layerRef.current === target) setBoard(EMPTY);
    }
  }, []);

  useEffect(() => {
    setBoard(EMPTY);
    if (layer) void fetchBoard(layer);
  }, [layer, fetchBoard]);

  useEffect(() => {
    const onFrame = (event: Event) => {
      const msg = (event as CustomEvent<{ layer?: unknown; board?: PlayerBoardView }>).detail;
      if (msg && msg.layer === layerRef.current && msg.board) setBoard(msg.board);
    };
    // A deleted note takes its lines and mark with it: re-read on note events.
    const onWorldEvent = (event: Event) => {
      const ev = (event as CustomEvent<{ event?: { type?: string; detail?: { playerNote?: boolean } } }>).detail?.event;
      if (ev?.type === 'entity_deleted' && ev.detail?.playerNote && layerRef.current) void fetchBoard(layerRef.current);
    };
    window.addEventListener('airp:player-board', onFrame);
    window.addEventListener('airp:world-event', onWorldEvent);
    return () => {
      window.removeEventListener('airp:player-board', onFrame);
      window.removeEventListener('airp:world-event', onWorldEvent);
    };
  }, [fetchBoard]);

  const write = useCallback(async (body: Parameters<typeof airpGateway.updatePlayerBoard>[0]) => {
    try {
      const result = await airpGateway.updatePlayerBoard(body);
      if (result.layer === layerRef.current) setBoard(result.board);
    } catch (error) {
      errorRef.current(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const note = useCallback(async (body: PlayerNoteRequest) => {
    try {
      const result = await airpGateway.playerNote(body);
      changedRef.current?.();
      if (body.op === 'delete' && layerRef.current) void fetchBoard(layerRef.current);
      return { path: result.path };
    } catch (error) {
      errorRef.current(error instanceof Error ? error.message : String(error));
      return null;
    }
  }, [fetchBoard]);

  const links = useMemo<LayerLink[]>(
    () => board.links.map((l) => ({ id: l.id, from: l.from, to: l.to, style: CLUE_LINK_STYLE, label: l.label ?? null })),
    [board],
  );
  const tags = useMemo(() => new Map(Object.entries(board.tags)), [board]);

  return {
    board,
    links,
    tags,
    link: (from, to, label) => write({ op: 'link', from, to, ...(label ? { label } : {}) }),
    unlink: (id) => write({ op: 'unlink', id }),
    tag: (path, tag) => write({ op: 'tag', path, tag }),
    note,
  };
}
