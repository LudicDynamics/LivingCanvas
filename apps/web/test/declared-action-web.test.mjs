import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';

const dialog = await readFile(new URL('../src/components/narrative/DeclaredActionDialog.tsx', import.meta.url), 'utf8');
const entity = await readFile(new URL('../src/components/narrative/EntityInteractions.tsx', import.meta.url), 'utf8');
// P2 moved the one `/api/choice` implementation into the shared hook so the
// card panel and the left rail cannot answer the same click differently.
const hook = await readFile(new URL('../src/lib/use-declared-choice.tsx', import.meta.url), 'utf8');
const rail = await readFile(new URL('../src/components/sidebar/ChoiceRail.tsx', import.meta.url), 'utf8');
const card = await readFile(new URL('../src/components/canvas/CardRenderer.tsx', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('stage consumes the frozen action snapshot and remains presentation-only before submit', () => {
  assert.match(dialog, /kind: DeclaredActionKind/);
  assert.match(dialog, /source: string[\s\S]*choice: string \| number[\s\S]*revision: string[\s\S]*items: DeclaredItem\[\][\s\S]*missing: string\[\][\s\S]*slots\?: MaterialSlot\[\]/);
  assert.doesNotMatch(dialog, /fetch\(|airpGateway|material-review/);
  assert.match(dialog, /Selecting materials does not submit or execute them/);
});

test('a material is used once, a slot holds up to maxItems, and required-slot readiness is explicit', () => {
  // One slot may hold several files (bb4511f); moving a file removes it from every other slot.
  assert.match(dialog, /Object\.entries\(selected\)\.map\(\(\[id, paths\]\) => \[id, paths\.filter\(p => p !== path\)\]\)/);
  assert.match(dialog, /current\.length >= slotCapacity\(slot\)[\s\S]*setError/);
  assert.match(dialog, /slots\.length > 0[\s\S]*Object\.values\(selected\)\.some\(paths => paths\.length > 0\)[\s\S]*slots\.every\(slot => !slot\.required \|\| \(selected\[slot\.id\]\?\.length \?\? 0\) > 0\)/);
  assert.match(dialog, /if \(!item \|\| !slot \|\| !isSelectable\(item, slot\)\)[\s\S]*setError/);
});

test('stage retry preserves the draft after an authoritative review failure', () => {
  assert.match(dialog, /try \{[\s\S]*await onSubmit\([\s\S]*catch \(reason\)[\s\S]*setError\([\s\S]*finally \{[\s\S]*setBusy\(false\)/);
  assert.doesNotMatch(dialog, /setSelected\(\{\}\)/);
  // `world` lets the server reject a panel opened before a world switch (409).
  assert.match(hook, /body: JSON\.stringify\(\{ world: action\.world, path: action\.source, choice: action\.choice, revision: action\.revision, selections \}\)/);
});

test('declared choices are classified through ActionFeedback and never become writer prompts before acceptance', () => {
  assert.match(hook, /runAction<DeclaredChoiceDetails>\('choice'/);
  assert.match(hook, /result\?\.outcome !== 'accepted'/);
  assert.match(hook, /result\.details\.action/);
  const declaredChoice = hook.slice(hook.indexOf('const executeDeclaredChoice'), hook.indexOf('const choose'));
  assert.doesNotMatch(declaredChoice, /onChoice\(/);
});

test('every choice click runs through /api/choice, never the writer draft', () => {
  const choose = hook.slice(hook.indexOf('const choose = '), hook.indexOf('const requestMaterialReview'));
  // Plain and declared choices leave through the same authoritative request;
  // only the server's `kind: writer` answer may reach the draft (handleDeclaredAction).
  assert.match(choose, /void executeDeclaredChoice\(path, choice\);/);
  assert.doesNotMatch(choose, /onChoice\(|setWriterDraft|reviewed the declared choice/);
});

test('the card panel and the left rail share one choice implementation', () => {
  // Both callers go through the hook…
  assert.match(entity, /useDeclaredChoice\(\{/);
  assert.match(rail, /useDeclaredChoice\(\{/);
  // …and neither of them reaches the gateway or the coordinator itself: one
  // `/api/choice` implementation is what keeps the design notes single.
  for (const [name, source] of [['EntityInteractions', entity], ['ChoiceRail', rail]]) {
    assert.doesNotMatch(source, /useActionFeedback\(/, name);
    assert.doesNotMatch(source, /airpGateway\.choose/, name);
    assert.doesNotMatch(source, /'\/api\/material-review'/, name);
  }
  // The rail calls the hook exactly once: it lists many cards, and a per-card
  // hook would be a hook in a loop.
  assert.equal((rail.match(/useDeclaredChoice\(/g) ?? []).length, 1);
  assert.match(rail, /resolveItem: path => byPath\.get\(path\) \?\? null/);
});

test('App runs widget choices and entity actions directly instead of parking them in the draft', () => {
  const runChoice = app.slice(app.indexOf('const runChoice = '), app.indexOf('const runEntityAction = '));
  assert.match(runChoice, /airpGateway\.choose\(path, choice\)/);
  assert.doesNotMatch(runChoice, /setWriterDraft/);
  const runEntityAction = app.slice(app.indexOf('const runEntityAction = '), app.indexOf('const createAt = '));
  assert.match(runEntityAction, /void submitWriterText\(prompt\)/);
  assert.doesNotMatch(runEntityAction, /setWriterDraft/);
  assert.doesNotMatch(app, /prepareChoiceDraft/);
});

test('a character elsewhere is visited first, then the dialogue opens in place', () => {
  const meet = app.slice(app.indexOf('const meetCharacter = '), app.indexOf('const closeRadial = '));
  assert.match(meet, /view\?\.state === 'elsewhere' && await navigateToCharacter\(id\) === 'failed'\) return;/);
  // The freshest closure opens the dialogue, so the caller projection is the layer just entered.
  assert.match(meet, /openCharacterRef\.current\(character\)/);
  assert.match(app, /onOpenCharacterModal=\{\(id\) => \{ void meetCharacter\(id\); \}\}/);
});

test('dice reward cards are read-only persisted outcome displays', () => {
  // Bound the persisted-reward branch at the next renderer branch so a
  // renamed legacy comment cannot accidentally make this test inspect a
  // different card's interaction authority.
  const outcome = card.slice(card.indexOf('if (frontmatter?.dice_reward)'), card.indexOf('if (frontmatter?.visual'));
  assert.match(outcome, /className="dice-outcome-letter"/);
  assert.match(outcome, /<MarkdownText text=\{body\}/);
  assert.doesNotMatch(outcome, /onDiceRolled|airpGateway|fetch\(/);
});

test('Prepare does not send to the writer; the separate Send review control does', () => {
  const submit = dialog.slice(dialog.indexOf('const submit ='), dialog.indexOf('return createPortal'));
  assert.doesNotMatch(submit, /onChoice|onSendReview/);
  assert.match(dialog, /onSendReview\(reviewPrompt\)/);

  // Stop at the actions-panel declaration: its widget callback intentionally
  // contains `onChoice`, while Prepare must only present material selections.
  // This boundary prevents the test from confusing the later writer handoff
  // with the authoritative material-review request.
  const materialSubmit = hook.slice(
    hook.indexOf('const submitMaterialReview'),
    hook.indexOf('const sendReview'),
  );
  assert.match(materialSubmit, /runAction<MaterialReviewDetails>\(\s*'act'/);
  assert.doesNotMatch(materialSubmit, /onChoice\s*\(/);

  // Inspect only the Send review callback so a future refactor cannot leave
  // the visible control inert while another unrelated callback satisfies it.
  const sendReview = hook.slice(hook.indexOf('const sendReview'), hook.indexOf('return {\n    choose,'));
  assert.match(sendReview, /onChoice\(prompt\)/);
  // Both surfaces mount the dialog through the same host, so a `read` opened
  // from the rail and from a card cannot diverge.
  assert.match(hook, /export function DeclaredChoiceHost/);
  for (const source of [entity, rail]) assert.match(source, /<DeclaredChoiceHost declared=\{declared\} focus=\{focus\} \/>/);
});
