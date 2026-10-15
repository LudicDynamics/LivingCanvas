#!/usr/bin/env node
/** Mechanical static gate for the frozen UX migration seams.
 *
 * This tool deliberately proves only source/registration facts. Runtime canvas
 * exclusivity, computed stacking, focus/inert and visual/audio timing remain
 * browser/replay evidence.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CONTRACT_PATH = 'tools/ux-contract.json';
const TOP_KEYS = new Set(['schemaVersion', 'docs', 'protectedPaths', 'visual', 'visualExceptions', 'depth', 'projection', 'fixtures']);
const KINDS = new Set(['exists', 'no-delete', 'unique-call', 'unique-listener', 'required-source', 'forbidden-source', 'css-declaration', 'depth', 'projection', 'visual-literal']);
const COMMON_KEYS = new Set(['id', 'kind', 'doc', 'owner', 'scope', 'target', 'expect', 'allow', 'forbid', 'reason']);
const EXPECT_KEYS = {
  'exists': new Set(['sentinel']),
  'no-delete': new Set(['sentinel']),
  'unique-call': new Set(['name', 'count']),
  'unique-listener': new Set(['event', 'count', 'mode']),
  'required-source': new Set(['literals']),
  'forbidden-source': new Set(['literals']),
  'css-declaration': new Set(['selector', 'property', 'value']),
  'depth': new Set(['registration']),
  'projection': new Set(['ownerLiteral', 'routeLiteral', 'markerLiteral', 'branches']),
  'visual-literal': new Set(['canonicalTokenFile', 'tokenPrefix', 'appearancePrefix', 'legacyAliases', 'literalKinds', 'exceptionRegistry']),
};
const RULE_GROUPS = ['visual', 'depth', 'projection'];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isRelativePath = (p) => typeof p === 'string' && p.length > 0 && !path.isAbsolute(p) && !p.split(/[\\/]/).includes('..');
const asArray = (v) => Array.isArray(v) ? v : [v];
const globToRegExp = (glob) => new RegExp(`^${glob.split('/').map((part) => part === '**' ? '.*' : part.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('/')}\/?$`);
const matches = (target, file) => target === file || (target.includes('*') && globToRegExp(target).test(file));
const lineOf = (text, offset) => text.slice(0, offset).split('\n').length;
const docOf = (rule) => ({ path: rule.doc.path, anchor: rule.doc.anchor });
const finding = (rule, file, line, message, fix) => ({ check: rule.kind, id: rule.id, file, line, message, fix, doc: docOf(rule) });

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|\s)\/\/.*$/gm, '$1');
}

function schemaError(message, file = CONTRACT_PATH) {
  return { check: 'contract-schema', id: 'contract-schema', file, line: 0, message, fix: 'repair the closed ux-contract.json schema', doc: { path: 'remote-frontend-migration-direction.md', anchor: 'UX contract checker design constraints' } };
}

export function validateContract(contract) {
  const errors = [];
  if (!isObject(contract)) return [schemaError('contract must be a JSON object')];
  for (const key of Object.keys(contract)) if (!TOP_KEYS.has(key)) errors.push(schemaError(`unknown top-level key \`${key}\``));
  if (contract.schemaVersion !== 1) errors.push(schemaError('schemaVersion must be 1'));
  if (!Array.isArray(contract.docs) || contract.docs.length === 0) errors.push(schemaError('docs must be a non-empty array'));
  if (!Array.isArray(contract.protectedPaths)) errors.push(schemaError('protectedPaths must be an array'));
  for (const [index, entry] of (contract.docs || []).entries()) {
    if (!isObject(entry) || Object.keys(entry).some((k) => !['path', 'anchor'].includes(k)) || !isRelativePath(entry.path) || typeof entry.anchor !== 'string' || !entry.anchor) errors.push(schemaError(`docs[${index}] has malformed path/anchor`));
  }
  for (const [index, entry] of (contract.protectedPaths || []).entries()) {
    if (!isObject(entry) || Object.keys(entry).some((k) => !['path', 'sentinel'].includes(k)) || !isRelativePath(entry.path) || typeof entry.sentinel !== 'string' || !entry.sentinel) errors.push(schemaError(`protectedPaths[${index}] requires only path and sentinel`));
  }
  if (!Array.isArray(contract.visualExceptions)) errors.push(schemaError('visualExceptions must be an array'));
  else for (const [index, exception] of contract.visualExceptions.entries()) {
    const allowed = ['id', 'target', 'selectorOrSymbol', 'kind', 'literals', 'assetUrls', 'properties', 'owner', 'reason', 'expiresAfter'];
    const expiry = new Date(`${exception?.expiresAfter}T23:59:59Z`).getTime();
    if (
      !isObject(exception) ||
      Object.keys(exception).some((key) => !allowed.includes(key)) ||
      typeof exception.id !== 'string' ||
      !(isRelativePath(exception.target) || (Array.isArray(exception.target) && exception.target.every(isRelativePath))) ||
      typeof exception.selectorOrSymbol !== 'string' ||
      !['material', 'illustration', 'asset'].includes(exception.kind) ||
      (!Array.isArray(exception.literals) && !Array.isArray(exception.assetUrls)) ||
      (Array.isArray(exception.literals) && exception.literals.some((literal) => typeof literal !== 'string' || !literal)) ||
      (Array.isArray(exception.assetUrls) && exception.assetUrls.some((url) => typeof url !== 'string' || !url)) ||
      !Array.isArray(exception.properties) ||
      typeof exception.owner !== 'string' ||
      typeof exception.reason !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(exception.expiresAfter || '') ||
      !Number.isFinite(expiry) ||
      expiry < Date.now()
    ) errors.push(schemaError(`visualExceptions[${index}] has malformed or expired exception fields`));
  }
  if (!Array.isArray(contract.fixtures)) errors.push(schemaError('fixtures must be an array'));
  else for (const [index, fixture] of contract.fixtures.entries()) {
    if (!isObject(fixture) || Object.keys(fixture).some((k) => !['id', 'group', 'status'].includes(k)) || typeof fixture.id !== 'string' || !['visual', 'depth', 'projection', 'protected'].includes(fixture.group) || !['clean', 'failure'].includes(fixture.status)) errors.push(schemaError(`fixtures[${index}] has unknown key or invalid value`));
  }
  for (const group of RULE_GROUPS) {
    if (!Array.isArray(contract[group])) { errors.push(schemaError(`${group} must be an array`)); continue; }
    for (const [index, rule] of contract[group].entries()) errors.push(...validateRule(rule, `${group}[${index}]`));
  }
  return errors;
}

function validateRule(rule, label) {
  const errors = [];
  if (!isObject(rule)) return [schemaError(`${label} must be an object` )];
  for (const key of Object.keys(rule)) if (!COMMON_KEYS.has(key)) errors.push(schemaError(`${label} has unknown key \`${key}\``));
  for (const key of COMMON_KEYS) if (!(key in rule)) errors.push(schemaError(`${label} is missing required key \`${key}\``));
  if (typeof rule.id !== 'string' || !rule.id) errors.push(schemaError(`${label}.id must be a non-empty string`));
  if (!KINDS.has(rule.kind)) errors.push(schemaError(`${label} has unknown kind \`${rule.kind}\``));
  if (!isObject(rule.doc) || Object.keys(rule.doc || {}).some((k) => !['path', 'anchor'].includes(k)) || !isRelativePath(rule.doc?.path) || typeof rule.doc?.anchor !== 'string' || !rule.doc.anchor) errors.push(schemaError(`${label}.doc must contain only path and anchor`));
  if (typeof rule.owner !== 'string' || typeof rule.scope !== 'string' || !isRelativePath(rule.target) && !(Array.isArray(rule.target) && rule.target.every(isRelativePath)) || !isObject(rule.expect) || !Array.isArray(rule.allow) || rule.allow.some((x) => typeof x !== 'string') || !Array.isArray(rule.forbid) || rule.forbid.some((x) => typeof x !== 'string') || typeof rule.reason !== 'string') errors.push(schemaError(`${label} has malformed common field types or path`));
  if (KINDS.has(rule.kind)) {
    const expected = EXPECT_KEYS[rule.kind];
    for (const key of Object.keys(rule.expect || {})) if (!expected.has(key)) errors.push(schemaError(`${label}.expect has unknown key \`${key}\``));
    for (const key of expected) if (!(key in (rule.expect || {}))) errors.push(schemaError(`${label}.expect is missing required key \`${key}\``));
    errors.push(...validateExpect(rule, label));
  }
  return errors;
}

function validateExpect(rule, label) {
  const e = rule.expect || {};
  const errors = [];
  const string = (key) => {
    if (typeof e[key] !== 'string' || !e[key]) errors.push(schemaError(`${label}.expect.${key} must be a non-empty string`));
  };
  if (['exists', 'no-delete', 'depth'].includes(rule.kind)) string(rule.kind === 'depth' ? 'registration' : 'sentinel');
  if (['unique-call', 'unique-listener'].includes(rule.kind)) {
    if (typeof e.count !== 'number' || !Number.isInteger(e.count) || e.count < 0) errors.push(schemaError(`${label}.expect.count must be a non-negative integer`));
    if (rule.kind === 'unique-call') string('name');
    else {
      string('event');
      if (!['event-listener', 'function'].includes(e.mode)) errors.push(schemaError(`${label}.expect.mode must be event-listener or function`));
    }
  }
  if (['required-source', 'forbidden-source'].includes(rule.kind)) {
    if (!Array.isArray(e.literals) || e.literals.some((x) => typeof x !== 'string' || !x)) errors.push(schemaError(`${label}.expect.literals must be an array of strings`));
  }
  if (rule.kind === 'css-declaration') for (const key of ['selector', 'property', 'value']) string(key);
  if (rule.kind === 'projection') {
    for (const key of ['ownerLiteral', 'routeLiteral', 'markerLiteral']) string(key);
    if (!Array.isArray(e.branches) || e.branches.some((x) => typeof x !== 'string' || !x)) errors.push(schemaError(`${label}.expect.branches must be an array of strings`));
  }
  if (rule.kind === 'visual-literal') {
    for (const key of ['canonicalTokenFile', 'tokenPrefix', 'appearancePrefix', 'exceptionRegistry']) string(key);
    for (const key of ['legacyAliases', 'literalKinds']) {
      if (!Array.isArray(e[key]) || e[key].some((value) => typeof value !== 'string' || !value)) errors.push(schemaError(`${label}.expect.${key} must be an array of strings`));
    }
  }
  return errors;
}

function ruleTargets(rule) { return asArray(rule.target); }
function occurrences(text, needle) { const out = []; let index = text.indexOf(needle); while (index >= 0) { out.push(index); index = text.indexOf(needle, index + needle.length); } return out; }

export function scanSource(text, options = {}) {
  const sourceFile = options.file || options.path || '<source>';
  if (typeof text !== 'string') return [schemaError('scanSource text must be a string', sourceFile)];
  const file = sourceFile;
  const rules = options.rules || RULE_GROUPS.flatMap((group) => options.contract?.[group] || []);
  const ruleSchema = options.contract ? validateContract(options.contract) : options.rules ? rules.flatMap((item, index) => validateRule(item, `rules[${index}]`)) : [];
  if (ruleSchema.length) return ruleSchema;
  const out = [];
  const source = stripComments(text);
  for (const rule of rules) {
    if (!rule || !KINDS.has(rule.kind) || !ruleTargets(rule).some((target) => matches(target, file))) continue;
    const add = (line, message, fix) => out.push(finding(rule, file, line, message, fix));
    const e = rule.expect;
    if (rule.kind === 'exists' || rule.kind === 'no-delete') {
      if (!text.includes(e.sentinel)) add(0, `required sentinel \`${e.sentinel}\` is missing`, 'restore the protected sentinel');
    } else if (rule.kind === 'required-source') {
      for (const literal of e.literals) if (!source.includes(literal)) add(0, `required source literal \`${literal}\` is missing`, 'restore the registered source seam');
      for (const literal of rule.forbid) for (const at of occurrences(source, literal)) add(lineOf(source, at), `forbidden source literal \`${literal}\` is present`, 'remove the forbidden parallel path');
    } else if (rule.kind === 'forbidden-source') {
      for (const literal of e.literals) for (const at of occurrences(source, literal)) add(lineOf(source, at), `forbidden source literal \`${literal}\` is present`, 'remove the forbidden parallel path');
    } else if (rule.kind === 'unique-call') {
      const re = new RegExp(`\\b${e.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(`, 'g');
      const hits = [...source.matchAll(re)].filter((m) => !/(?:function|interface|type)\s+$/.test(source.slice(Math.max(0, m.index - 30), m.index)));
      if (hits.length !== e.count) add(hits[0] ? lineOf(source, hits[0].index) : 0, `expected ${e.count} runtime call(s) to \`${e.name}\`, found ${hits.length}`, 'keep one runtime consumer and exclude declarations from the count');
    } else if (rule.kind === 'unique-listener') {
      let hits;
      if (e.mode === 'event-listener') {
        const re = new RegExp(`addEventListener\\s*\\(\\s*['\"]${e.event.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}['\"]`, 'g');
        hits = [...source.matchAll(re)];
      } else {
        const re = new RegExp(`(?:const|function)\\s+${e.event.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`, 'g');
        hits = [...source.matchAll(re)];
      }
      if (hits.length !== e.count) add(hits[0] ? lineOf(source, hits[0].index) : 0, `expected ${e.count} ${e.mode} registration(s) for \`${e.event}\`, found ${hits.length}`, 'preserve the event-specific unique consumer path');
    } else if (rule.kind === 'css-declaration') {
      const blockRe = new RegExp(`${e.selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\{]*\\{([\\s\\S]*?)\\}`, 'g');
      let good = false;
      for (const match of source.matchAll(blockRe)) {
        const body = match[1];
        const declaration = new RegExp(`${e.property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*${e.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*;?`).test(body);
        if (declaration) good = true;
        if (new RegExp(`${e.property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*auto\\b`).test(body)) add(lineOf(source, match.index), `${e.selector} overrides ${e.property} with auto`, 'remove the pointer-event override from the ghost selector');
      }
      if (!good) add(0, `${e.selector} must declare ${e.property}: ${e.value}`, 'restore the canonical CSS declaration');
    } else if (rule.kind === 'visual-literal') {
      const canonical = e.canonicalTokenFile;
      if (file === canonical) continue;
      const exceptions = options.contract?.visualExceptions || [];
      const declaration = /([-\w]+)\s*:\s*([^;\n}]+)/g;
      const allowedValue = (value) => /var\(--(?:ux|appearance)-[\w-]+\)|\b(?:transparent|currentColor|inherit|none)\b/.test(value);
      const patterns = [
        ['color', /(?:#[\da-f]{3,8}\b|\b(?:rgba?|hsla?)\s*\(|\b(?:white|black|red|blue|green|gray|grey)\b)/i],
        ['gradient', /\b(?:repeating-)?(?:linear|radial|conic)-gradient\s*\(/i],
        ['shadow', /\b(?:inset\s+)?-?\d+(?:\.\d+)?(?:px|rem|em)\b.*\b(?:rgba?|#[\da-f]{3,8})/i],
        ['radius', /\b\d+(?:\.\d+)?(?:px|rem|em|%)\b/i],
        ['font', /(?:^|,)\s*[A-Za-z][\w -]*(?:,\s*|$)/],
        ['motion', /\b\d+(?:\.\d+)?m?s\b|cubic-bezier\s*\(/i],
      ];
      const exceptionMatches = (property, value, offset) => exceptions.some((exception) => {
        const targets = asArray(exception.target);
        const literalMatch = (exception.literals || []).some((literal) => value.includes(literal));
        const selectorAt = source.slice(0, offset).lastIndexOf(exception.selectorOrSymbol);
        const blockStart = selectorAt >= 0 ? source.indexOf('{', selectorAt) : -1;
        const blockEnd = blockStart >= 0 ? source.indexOf('}', blockStart) : -1;
        return targets.includes(file) &&
          selectorAt >= 0 &&
          blockStart >= 0 &&
          (blockEnd < 0 || blockEnd >= offset) &&
          exception.properties.includes(property) &&
          literalMatch &&
          new Date(`${exception.expiresAfter}T23:59:59Z`).getTime() >= Date.now();
      });
      for (const match of source.matchAll(declaration)) {
        const property = match[1];
        const value = match[2].trim();
        if (property.startsWith(e.tokenPrefix)) {
          add(lineOf(source, match.index), `canonical token definition \`${property}\` is outside ${canonical}`, `move ${property} into the canonical token file`);
          continue;
        }
        const propertyKind =
          /(?:gradient)/i.test(value) && /^background(?:-image)?$/i.test(property) ? 'gradient' :
          /^(?:color|background(?:-color)?|border(?:-[\w-]+)?)$/i.test(property) ? 'color' :
          /(?:shadow|filter)/i.test(property) ? 'shadow' :
          property === 'border-radius' ? 'radius' :
          /^font(?:-|$)/i.test(property) ? 'font' :
          /^(?:transition|animation(?:-duration|-timing-function)?)$/i.test(property) ? 'motion' :
          null;
        if (!propertyKind || allowedValue(value)) continue;
        const pattern = patterns.find(([kind]) => kind === propertyKind)?.[1];
        if (!pattern?.test(value)) continue;
        if (exceptionMatches(property, value, match.index)) continue;
        add(lineOf(source, match.index), `unregistered ${propertyKind} literal \`${value}\``, `migrate ${property} to a canonical ${e.tokenPrefix} token or add a precise, unexpired material/illustration exception`);
      }
      for (const alias of e.legacyAliases) {
        for (const at of occurrences(source, `var(${alias})`)) add(lineOf(source, at), `legacy visual alias \`${alias}\` is consumed`, `replace ${alias} with a canonical ${e.tokenPrefix} token`);
      }
    } else if (rule.kind === 'depth') {
      const zRe = /(?:z-index|zIndex)\s*:\s*([^,;}\n]+)/g;
      for (const match of source.matchAll(zRe)) {
        const value = match[1].trim();
        if (/(?<![\w-])\d+(?:\.\d+)?(?![\w-])/.test(value)) add(lineOf(source, match.index), `unregistered numeric depth \`${value}\` in ${rule.scope}`, 'register a semantic depth token/context; numeric bands belong to the Depth document');
      }
    } else if (rule.kind === 'projection') {
      for (const [label, literal] of [['owner', e.ownerLiteral], ['route', e.routeLiteral], ['active marker', e.markerLiteral]]) if (!source.includes(literal)) add(0, `projection ${label} literal \`${literal}\` is missing`, 'keep App as the sole projection owner and retain its marker');
      for (const branch of e.branches) if (!source.includes(branch)) add(0, `mutually-exclusive projection branch \`${branch}\` is missing`, 'encode the Nook/layer handoff as explicit conditional branches');
    }
  }
  return out;
}

function allRules(contract) { return RULE_GROUPS.flatMap((group) => contract[group] || []); }

export function compare(actual, contract) {
  const schema = validateContract(contract);
  if (schema.length) return schema;
  if (!isObject(actual)) return [schemaError('compare actual must be an object', '<actual>')];
  if (Array.isArray(actual.findings)) return actual.findings;
  const sources = actual.sources instanceof Map ? [...actual.sources.entries()] : Object.entries(actual.sources || {});
  const out = [];
  for (const exception of contract.visualExceptions || []) {
    for (const target of asArray(exception.target)) {
      const source = sources.find(([file]) => matches(target, file));
      if (!source) out.push(schemaError(`visual exception target path has no source: ${target}`, target));
      else if (!source[1].includes(exception.selectorOrSymbol)) out.push(schemaError(`visual exception selector is absent: ${target} :: ${exception.selectorOrSymbol}`, target));
      else if ((exception.literals || []).length && !(exception.literals || []).some((literal) => source[1].includes(literal))) out.push(schemaError(`visual exception literal is absent: ${target} :: ${exception.id}`, target));
    }
  }
  for (const rule of allRules(contract)) for (const target of ruleTargets(rule)) if (!sources.some(([file]) => matches(target, file))) out.push(schemaError(`contract target path has no source: ${target}`, target));
  if (out.length) return out;
  for (const [file, text] of sources) out.push(...scanSource(text, { file, rules: allRules(contract), contract }));
  return out;
}

function protectedFindings(repoRoot, contract, baseRef) {
  const out = [];
  for (const entry of contract.protectedPaths) {
    const full = path.join(repoRoot, entry.path);
    if (!fs.existsSync(full)) out.push(schemaError(`protected path is missing: ${entry.path}`, entry.path));
    else if (!fs.readFileSync(full, 'utf8').includes(entry.sentinel)) out.push(schemaError(`protected sentinel is missing: ${entry.path} :: ${entry.sentinel}`, entry.path));
  }
  if (baseRef !== undefined && baseRef !== null) {
    try {
      execFileSync('git', ['rev-parse', '--verify', `${baseRef}^{commit}`], { cwd: repoRoot, stdio: 'pipe' });
      const deleted = execFileSync('git', ['diff', '--name-only', '--diff-filter=D', baseRef, '--', ...contract.protectedPaths.map((entry) => entry.path)], { cwd: repoRoot, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
      for (const file of deleted) out.push(schemaError(`protected path was deleted relative to ${baseRef}: ${file}`, file));
    } catch {
      out.push(schemaError(`requested baseline \`${baseRef}\` cannot be resolved; no-delete comparison failed closed`, CONTRACT_PATH));
    }
  }
  return out;
}

export function scanRepo({ repoRoot = REPO, baseRef, contract }) {
  const schema = validateContract(contract);
  if (schema.length) return { summary: { findings: schema.length, files: 0 }, findings: schema };
  const sources = new Map();
  const paths = new Set();
  for (const rule of allRules(contract)) for (const target of ruleTargets(rule)) paths.add(target);
  for (const target of paths) {
    const exact = !target.includes('*');
    const full = path.join(repoRoot, target);
    if (exact) {
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return { summary: { findings: 1, files: sources.size }, findings: [schemaError(`contract target path is missing: ${target}`, target)] };
      sources.set(target, fs.readFileSync(full, 'utf8'));
    } else {
      const dir = path.dirname(target.split('*')[0]);
      const root = path.join(repoRoot, dir || '.');
      const found = [];
      if (fs.existsSync(root)) {
        const walk = (current) => { for (const entry of fs.readdirSync(current, { withFileTypes: true })) { const fullEntry = path.join(current, entry.name); if (entry.isDirectory()) walk(fullEntry); else { const rel = path.relative(repoRoot, fullEntry).split(path.sep).join('/'); if (matches(target, rel)) found.push(rel); } } };
        walk(root);
      }
      if (!found.length) return { summary: { findings: 1, files: sources.size }, findings: [schemaError(`contract target glob has no files: ${target}`, target)] };
      for (const rel of found) sources.set(rel, fs.readFileSync(path.join(repoRoot, rel), 'utf8'));
    }
  }
  const findings = [...protectedFindings(repoRoot, contract, baseRef), ...compare({ sources }, contract)];
  const summary = { findings: findings.length, files: sources.size, rules: allRules(contract).length, protectedPaths: contract.protectedPaths.length };
  return { summary, findings };
}

function loadContract(file = path.join(REPO, CONTRACT_PATH)) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { return { __parseError: error instanceof Error ? error.message : String(error) }; }
}

function main() {
  const contract = loadContract();
  const result = contract.__parseError
    ? { summary: { findings: 1, files: 0 }, findings: [schemaError(`malformed JSON: ${contract.__parseError}`)] }
    : scanRepo({ repoRoot: REPO, baseRef: process.env.UX_BASE_REF, contract });
  if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else if (!result.findings.length) console.log(`check-ux-contract: clean (${result.summary.rules} rules, ${result.summary.files} files)`);
  else { for (const f of result.findings) { console.log(`${f.check.toUpperCase().padEnd(18)} ${f.file}:${f.line}`); console.log(`  ${f.message}`); console.log(`  fix: ${f.fix}`); } console.log(`\ncheck-ux-contract: ${result.findings.length} finding(s)`); }
  return result.findings.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main());
