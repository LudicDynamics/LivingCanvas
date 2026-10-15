export interface AutoLayoutBox {
  id: string;
  w: number;
  h: number;
  order?: number;
}

export interface AutoLayoutRect {
  id?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FlowLayoutConfig {
  origin: { x: number; y: number };
  columnHeight: number;
  gapX: number;
  gapY: number;
  obstacleGap: number;
  maxColumns: number;
}

export interface FlowLayoutResult {
  placements: Array<{ id: string; x: number; y: number; w: number; h: number }>;
  exhausted: boolean;
  columnsUsed: number;
}

const DEFAULT_CONFIG: FlowLayoutConfig = {
  origin: { x: 360, y: 96 },
  columnHeight: 1080,
  gapX: 56,
  gapY: 32,
  obstacleGap: 22,
  maxColumns: 64,
};

type Placement = FlowLayoutResult['placements'][number];

function fail(message: string): never {
  throw new TypeError(`flowColumns: ${message}`);
}

function finitePositive(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    fail(`${name} must be a finite positive number`);
  }
}

function finiteNumber(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${name} must be finite`);
  }
}

function compareAscii(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function validateBoxes(boxes: readonly AutoLayoutBox[]): void {
  const ids = new Set<string>();
  for (const box of boxes) {
    if (box === null || typeof box !== 'object' || typeof box.id !== 'string' || box.id.length === 0) {
      fail('each box must have a non-empty id');
    }
    if (ids.has(box.id)) fail(`duplicate box id: ${box.id}`);
    ids.add(box.id);
    finitePositive(box.w, `box ${box.id} width`);
    finitePositive(box.h, `box ${box.id} height`);
    if (box.order !== undefined) finiteNumber(box.order, `box ${box.id} order`);
  }
}

function validateOccupied(occupied: readonly AutoLayoutRect[]): void {
  for (const rect of occupied) {
    if (rect === null || typeof rect !== 'object') fail('each occupied rectangle must be an object');
    finiteNumber(rect.x, 'occupied x');
    finiteNumber(rect.y, 'occupied y');
    finitePositive(rect.w, 'occupied width');
    finitePositive(rect.h, 'occupied height');
    if (rect.id !== undefined && typeof rect.id !== 'string') {
      fail('occupied id must be a string when present');
    }
  }
}

function configOf(config: Partial<FlowLayoutConfig> | undefined): FlowLayoutConfig {
  const input = config ?? {};
  const originInput = input.origin ?? DEFAULT_CONFIG.origin;
  if (originInput === null || typeof originInput !== 'object') fail('origin must be an object');

  const result: FlowLayoutConfig = {
    origin: { x: originInput.x, y: originInput.y },
    columnHeight: input.columnHeight ?? DEFAULT_CONFIG.columnHeight,
    gapX: input.gapX ?? DEFAULT_CONFIG.gapX,
    gapY: input.gapY ?? DEFAULT_CONFIG.gapY,
    obstacleGap: input.obstacleGap ?? DEFAULT_CONFIG.obstacleGap,
    maxColumns: input.maxColumns ?? DEFAULT_CONFIG.maxColumns,
  };

  finiteNumber(result.origin.x, 'origin x');
  finiteNumber(result.origin.y, 'origin y');
  finitePositive(result.columnHeight, 'columnHeight');
  for (const [name, value] of [
    ['gapX', result.gapX],
    ['gapY', result.gapY],
    ['obstacleGap', result.obstacleGap],
  ] as const) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      fail(`${name} must be a finite non-negative number`);
    }
  }
  if (typeof result.maxColumns !== 'number' || !Number.isInteger(result.maxColumns) || result.maxColumns <= 0) {
    fail('maxColumns must be a positive integer');
  }
  return result;
}

function expandedCollision(
  x: number,
  y: number,
  w: number,
  h: number,
  rect: AutoLayoutRect,
  gap: number,
): boolean {
  return (
    x < rect.x + rect.w + gap &&
    x + w > rect.x - gap &&
    y < rect.y + rect.h + gap &&
    y + h > rect.y - gap
  );
}

function conflictsAt(
  x: number,
  y: number,
  box: AutoLayoutBox,
  occupied: readonly AutoLayoutRect[],
  obstacleGap: number,
): AutoLayoutRect[] {
  return occupied.filter((rect) => expandedCollision(x, y, box.w, box.h, rect, obstacleGap));
}

/**
 * Stable column-major placement. Existing obstacles are never moved; input
 * boxes are placed in order, top-to-bottom, then left-to-right.
 */
export function flowColumns(
  boxes: readonly AutoLayoutBox[],
  occupied: readonly AutoLayoutRect[],
  config?: Partial<FlowLayoutConfig>,
): FlowLayoutResult {
  if (!Array.isArray(boxes)) fail('boxes must be an array');
  if (!Array.isArray(occupied)) fail('occupied must be an array');
  validateBoxes(boxes);
  validateOccupied(occupied);
  const settings = configOf(config);
  if (boxes.length === 0) return { placements: [], exhausted: false, columnsUsed: 0 };

  const ordered = [...boxes].sort((a, b) => {
    const aOrder = a.order;
    const bOrder = b.order;
    if (aOrder === undefined && bOrder !== undefined) return 1;
    if (aOrder !== undefined && bOrder === undefined) return -1;
    if (aOrder !== undefined && bOrder !== undefined && aOrder !== bOrder) return aOrder - bOrder;
    return compareAscii(a.id, b.id);
  });

  const occupiedView: AutoLayoutRect[] = [...occupied];
  const placements: Placement[] = [];
  let exhausted = false;
  let columnsUsed = 1;
  let columnX = settings.origin.x;
  let cursorY = settings.origin.y;
  let columnMaxRight = columnX;
  let columnHasPlacement = false;
  // A new column scans right when its first candidate is blocked. The initial
  // column instead scans downward, preserving the top-left origin semantics.
  let scanRight = false;

  const startColumn = (nextX: number): boolean => {
    if (columnsUsed >= settings.maxColumns) return false;
    columnsUsed += 1;
    columnX = nextX;
    cursorY = settings.origin.y;
    columnMaxRight = columnX;
    columnHasPlacement = false;
    scanRight = true;
    return true;
  };

  const place = (box: AutoLayoutBox, x: number, y: number): void => {
    const placement: Placement = { id: box.id, x, y, w: box.w, h: box.h };
    placements.push(placement);
    occupiedView.push(placement);
    columnHasPlacement = true;
    columnMaxRight = Math.max(columnMaxRight, x + box.w);
    cursorY = y + box.h + settings.gapY;
    scanRight = false;
  };

  for (const box of ordered) {
    const oversized = box.h > settings.columnHeight;
    let done = false;
    let columnBlockedForBox = false;

    while (!done) {
      // An oversized card must own a column when there is already a card in
      // the current one. If the column limit is reached, continue scanning
      // this final column and retain the resulting deterministic candidate.
      if (oversized && columnHasPlacement && !columnBlockedForBox) {
        const nextX = columnMaxRight + settings.gapX;
        if (startColumn(nextX)) continue;
        exhausted = true;
        columnBlockedForBox = true;
        scanRight = false;
      }

      if (scanRight) {
        const candidateY = settings.origin.y;
        const conflicts = conflictsAt(columnX, candidateY, box, occupiedView, settings.obstacleGap);
        if (conflicts.length > 0) {
          const nextX = Math.max(...conflicts.map((rect) => rect.x + rect.w + settings.obstacleGap));
          if (!startColumn(nextX)) {
            exhausted = true;
            place(box, columnX, candidateY);
            done = true;
            continue;
          }
          continue;
        }
        place(box, columnX, candidateY);
        done = true;
        continue;
      }

      let candidateY = cursorY;
      while (true) {
        const conflicts = conflictsAt(columnX, candidateY, box, occupiedView, settings.obstacleGap);
        if (conflicts.length === 0) break;
        candidateY = Math.max(...conflicts.map((rect) => rect.y + rect.h + settings.obstacleGap));
      }

      if (!oversized && candidateY + box.h > settings.origin.y + settings.columnHeight) {
        const nextX = columnMaxRight + settings.gapX;
        if (!startColumn(nextX)) {
          exhausted = true;
          place(box, columnX, candidateY);
          done = true;
          continue;
        }
        continue;
      }

      place(box, columnX, candidateY);
      done = true;
    }
  }

  return { placements, exhausted, columnsUsed };
}
