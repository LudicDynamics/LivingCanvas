export interface ShellState { header: boolean; journal: boolean; immersive: boolean }
export const initialShell: ShellState;
export function separateBounds(bounds: { x: number; y: number; w: number; h: number }[]): { x: number; y: number; w: number; h: number }[];
export function transitionShell(state: ShellState, action: 'header' | 'journal' | 'immersion'): ShellState;
