/** A hover-only visual annotation, independent of persisted relationship links. */
export function highlightChalkAnchor(source: HTMLElement, sourcePath: string, anchor: unknown): (() => void) | undefined {
  if (typeof anchor !== 'string' || !anchor.trim()) return;
  const plane = source.parentElement;
  if (!plane) return;
  const folder = sourcePath.slice(0, sourcePath.lastIndexOf('/') + 1);
  const candidates = new Set([anchor, `${folder}${anchor}`, `${folder}${anchor}.md`]);
  const matches = Array.from(plane.querySelectorAll<HTMLElement>('.object[data-path]'))
    .filter(node => node !== source && candidates.has(node.dataset.path || ''));
  if (matches.length !== 1) return;
  const target = matches[0];
  const line = document.createElement('div');
  line.className = 'chalk-anchor-thread';
  line.setAttribute('aria-hidden', 'true');
  plane.append(line);
  target.classList.add('chalk-anchor-lit');
  const update = () => {
    const x = source.offsetLeft + source.offsetWidth / 2;
    const y = source.offsetTop + source.offsetHeight / 2;
    const dx = target.offsetLeft + target.offsetWidth / 2 - x;
    const dy = target.offsetTop + target.offsetHeight / 2 - y;
    Object.assign(line.style, { left: `${x}px`, top: `${y}px`, width: `${Math.hypot(dx, dy)}px`, transform: `rotate(${Math.atan2(dy, dx)}rad)` });
  };
  update();
  // No `pointermove` listener: the thread spans two fixed shells, so it only
  // changes when either box resizes. A pointermove handler that reads `offset*`
  // forces reflow on every move (AGENTS §7.6③).
  const observer = new ResizeObserver(update);
  observer.observe(source);
  observer.observe(target);
  return () => {
    observer.disconnect();
    line.remove();
    target.classList.remove('chalk-anchor-lit');
  };
}
