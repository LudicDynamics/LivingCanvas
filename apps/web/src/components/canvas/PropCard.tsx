import { airpGateway } from '../../lib/airp-gateway.js';
import type { AppearanceView } from '../../lib/appearance-view.js';
import './prop-card.css';

interface Props {
  visual: 'envelope' | 'phone' | 'door';
  path?: string;
  filename?: string;
  title: string;
  body: string;
  frontmatter?: Record<string, any> | null;
  image?: string;
  /** Inspect state is owned by CanvasObject; PropCard only paints it. */
  inspected?: boolean;
  appearance?: AppearanceView | null;
}

/** Prop shape is presentation only; CanvasObject owns inspect/read/enter seams. */
export function PropCard({ visual, title, image, inspected = false, appearance }: Props) {
  const hint = visual === 'door' ? 'DOUBLE-CLICK TO ENTER · INSPECT' : 'CLICK TO INSPECT';
  return (
    <div
      className={`cabin-prop cabin-prop--${visual}${inspected ? ' cabin-prop--inspected' : ''}`}
      aria-label={title}
      {...appearance?.attrs}
      style={appearance?.style}
    >
      {image ? <img src={airpGateway.assetUrl(image, undefined, 'image')} alt="" /> : <span className="cabin-prop__shape" aria-hidden="true"><i /><b /></span>}
      <span className="cabin-prop__label">{title}</span>
      <span className="cabin-prop__hint">{hint}</span>
    </div>
  );
}
