export const DEPTH_SURFACE_KINDS = [
  'background',
  'world',
  'overlay',
  'entity',
  'writer',
  'modal',
  'ui',
] as const;

export type DepthSurfaceKind = (typeof DEPTH_SURFACE_KINDS)[number];
export type DepthSurfaceToken = `--depth-${DepthSurfaceKind}`;
export type DepthSurfaceClass = `depth-surface--${DepthSurfaceKind}`;

export interface DepthSurface {
  readonly kind: DepthSurfaceKind;
  readonly token: DepthSurfaceToken;
  readonly className: DepthSurfaceClass;
}

const DEPTH_SURFACES: Readonly<Record<DepthSurfaceKind, DepthSurface>> = {
  background: { kind: 'background', token: '--depth-background', className: 'depth-surface--background' },
  world: { kind: 'world', token: '--depth-world', className: 'depth-surface--world' },
  overlay: { kind: 'overlay', token: '--depth-overlay', className: 'depth-surface--overlay' },
  entity: { kind: 'entity', token: '--depth-entity', className: 'depth-surface--entity' },
  writer: { kind: 'writer', token: '--depth-writer', className: 'depth-surface--writer' },
  modal: { kind: 'modal', token: '--depth-modal', className: 'depth-surface--modal' },
  ui: { kind: 'ui', token: '--depth-ui', className: 'depth-surface--ui' },
};

const DEPTH_SURFACE_ORDER: readonly DepthSurfaceKind[] = [
  'background',
  'world',
  'entity',
  'overlay',
  'writer',
  'modal',
  'ui',
];

function hasDepthSurface(value: unknown): value is DepthSurfaceKind {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(DEPTH_SURFACES, value);
}


export function depthSurface(kind: unknown): DepthSurface {
  if (!hasDepthSurface(kind)) {
    throw new RangeError(`Unknown depth surface kind: ${String(kind)}`);
  }
  return DEPTH_SURFACES[kind];
}

export function depthTokenFor(kind: unknown): DepthSurfaceToken {
  return depthSurface(kind).token;
}

export function depthClassFor(kind: unknown): DepthSurfaceClass {
  return depthSurface(kind).className;
}

export function depthSurfaceOrder(): readonly DepthSurfaceKind[] {
  return DEPTH_SURFACE_ORDER;
}
