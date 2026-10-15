import wuwu from './wuwu.mjs';
import holmes from './holmes.mjs';
// Divergence (timeline) and First Snow are not part of the open-source copy: their packs are
// loaded only where the files exist, so the tools still run on the worlds that ship.
const optionalPack = async (file) => {
  try { return (await import(file)).default; } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND' && String(error.message).includes(file.slice(2))) return null;
    throw error;
  }
};
const timeline = await optionalPack('./timeline.mjs');
const snow = await optionalPack('./first-snow.mjs');
import academy from './academy.mjs';
import door from './unwritten.mjs';
import { mappedPath, segment, textRefs, jsonRefs } from '../migrate-japanese-paths.mjs';
import { characterNookFiles } from './character-nooks.mjs';
import { decouplePack } from './choice-bindings.mjs';
import { plainLanguagePack } from './plain-language.mjs';
// Localized authoring labels compile through a fixed migration table, not a
// transliteration guess. The same mapping upgrades existing saves.
export const experiences = [wuwu, holmes, timeline, snow, academy, door].filter(Boolean).map(pack => ({
  ...pack,
  files: {
    ...Object.fromEntries(Object.entries(pack.files).map(([file, text]) => [mappedPath(file), textRefs(text)])),
    ...Object.fromEntries(pack.characters.flatMap(c => Object.entries(characterNookFiles(pack.base, { ...c, id: segment(c.id) }))
      .map(([file, text]) => [`characters/${segment(c.id)}/${file}`, text]))),
  },
  scenes: pack.scenes.map(mappedPath),
  characters: pack.characters.map(c => ({ ...c, id: segment(c.id), home: mappedPath(c.home), body: textRefs(c.body) })),
  checks: jsonRefs(pack.checks),
})).map(decouplePack).map(plainLanguagePack);
