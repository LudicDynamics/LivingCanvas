import React, { useState } from 'react';
import { plainExcerpt } from '../../lib/md.js';
import { airpGateway } from '../../lib/airp-gateway.js';
import { npcInitial } from '../../lib/npc-dialogue.js';
import './npc-card.css';

/**
 * An NPC card on the canvas: a person you can talk
 * to, drawn as a portrait when the world ships one and as a silhouette with the
 * first letter of their name until it does. Talking is EntityInteractions'
 * 「对话」 button, like every other card action.
 */
export function NpcCard({ path, filename, frontmatter, body }: {
  path: string;
  filename: string;
  frontmatter: Record<string, any>;
  body: string;
}): React.ReactElement {
  const [failed, setFailed] = useState(false);
  const name = typeof frontmatter.name === 'string' && frontmatter.name.trim() ? frontmatter.name.trim() : filename.replace(/\.md$/, '');
  const avatar = typeof frontmatter.avatar === 'string' && frontmatter.avatar.trim() && !failed
    ? airpGateway.assetUrl(frontmatter.avatar.trim(), undefined, 'image')
    : null;
  const excerpt = plainExcerpt(body ?? '');
  return (
    <article className="npc-card" data-npc-card={path} data-has-portrait={avatar ? 'true' : 'false'}>
      <div className="npc-card__portrait" aria-hidden="true">
        {avatar
          ? <img src={avatar} alt="" onError={() => setFailed(true)} />
          : <span className="npc-card__initial">{npcInitial(name)}</span>}
      </div>
      <h3 className="npc-card__name">{name}</h3>
      {excerpt && <p className="npc-card__excerpt">{excerpt}</p>}
    </article>
  );
}
