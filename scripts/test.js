#!/usr/bin/env node
/* Offline tests for Jev Lens — no Obsidian or API needed.
 * Loads main.js with stubbed `obsidian` module and checks the pure logic:
 * lens parsing, question generation, hashing.
 *
 * Usage: node scripts/test.js */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let code = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');

/* --- stub the obsidian module ------------------------------------------ */
class Stub {}
const obsidian = {
  Plugin: Stub, PluginSettingTab: Stub, Setting: Stub,
  MarkdownView: Stub, Notice: Stub, requestUrl: async () => ({}),
};
code += '\nmodule.exports.__test = { parseLensesFromNote, lensQuestions, hashStr, DEFAULT_SETTINGS };';

const mod = { exports: {} };
new Function('require', 'module', 'exports', code)(() => obsidian, mod, mod.exports);
const { parseLensesFromNote, lensQuestions, hashStr, DEFAULT_SETTINGS } = mod.exports.__test;

/* --- tests -------------------------------------------------------------- */
let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
}

// 1. parses the bundled template (placeholders, 4 lenses)
const template = fs.readFileSync(path.join(ROOT, 'examples', 'lenses-template.md'), 'utf8');
const lenses = parseLensesFromNote(template);
check('template: 4 lenses parsed', lenses && lenses.length === 4,
  `got ${lenses ? lenses.length : 'null'}`);
check('template: placeholder names kept', lenses && lenses.every(l => l.name.includes('THEME NAME')));
check('template: Covers lines used as definitions',
  lenses && lenses[0].definition.startsWith('<One or two sentences'));

// 2. falls back to null when the note has no lens sections
check('empty note -> null (fallback expected)', parseLensesFromNote('# Nothing here\n\ntext') === null);

// 3. question generation
const q = lensQuestions(lenses);
check('questions: one per lens', Object.keys(q).length === lenses.length);
const first = q.lens_0;
check('questions: score type', first.type === 'score');
check('questions: 4 rubric levels', Array.isArray(first.criteria) && first.criteria.length === 4);
check('questions: definition embedded in instructions',
  first.instructions.includes(lenses[0].name) && first.instructions.includes(lenses[0].definition));

// 4. hashing is deterministic and length-sensitive
check('hash: deterministic', hashStr('abc') === hashStr('abc'));
check('hash: distinguishes content', hashStr('abc') !== hashStr('abd'));

// 5. no personal paths in shipped defaults
check('defaults: generic lenses path', DEFAULT_SETTINGS.lensesPath === 'Lenses.md');

if (failures) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log('\nAll tests passed');
