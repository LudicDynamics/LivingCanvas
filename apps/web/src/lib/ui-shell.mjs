export const initialShell = { header: false, journal: false, immersive: false };

export function transitionShell(state, action) {
  if (action === 'immersion') return { ...initialShell, immersive: !state.immersive };
  if (action === 'header' || action === 'journal') return { ...state, immersive: false, [action]: !state[action] };
  return state;
}

export function separateBounds(bounds) {
  const placed = [];
  return bounds.map(box => {
    const next = { ...box };
    for (let pass = 0; pass < bounds.length; pass++) {
      for (const other of placed) {
        if (next.x < other.x + other.w + 30 && next.x + next.w + 30 > other.x && next.y < other.y + other.h + 30 && next.y + next.h + 30 > other.y) next.y = other.y + other.h + 30;
      }
    }
    placed.push(next);
    return next;
  });
}
