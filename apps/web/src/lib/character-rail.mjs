// Pure derivation for the right-hand character rail.
// Contract §2.2 is the ONLY membership rule: three states, no fourth tier.
// No i18n, no DOM — the .tsx maps the returned keys through t().
// Run the unit tests with: node --test apps/web/test/character-rail.test.mjs

/**
 * @param {{ state: 'in-scene' | 'elsewhere' | 'absent', following: boolean }} view
 *   A `CharacterPresenceView` (contract §4.1); only these two fields are read.
 * @returns {{
 *   canTalk: boolean,
 *   canTravel: boolean,
 *   statusKey: string,
 *   followActionKey: string,
 *   talkHintKey: string | null,
 *   tone: 'full' | 'muted',
 *   followedByPlayer: boolean,
 * }}
 */
export function railEntry(view) {
  const inScene = view.state === 'in-scene';
  const absent = view.state === 'absent';
  return {
    canTalk: inScene,
    canTravel: !absent,
    statusKey: inScene ? 'In this scene' : absent ? 'Not here' : 'Elsewhere',
    followActionKey: view.following ? 'Dismiss' : 'Follow',
    talkHintKey: inScene ? null
      : absent ? 'They are not here right now.'
      : 'They are in another scene. Go to them instead.',
    // Contract §2.2: `in-scene` is the only full-colour tier; `elsewhere` and
    // `absent` share the muted tier so they are visually indistinguishable by
    // colour (the status label is what tells them apart).
    tone: inScene ? 'full' : 'muted',
    followedByPlayer: view.following,
  };
}
