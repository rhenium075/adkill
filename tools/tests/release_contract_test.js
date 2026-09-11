'use strict';
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const { validateRelease } = require('../validate_release');
const template = fs.readFileSync(path.join(__dirname, '../../adkill_mitm.sgmodule'), 'utf8');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adkill-contract-'));
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const replaceSha = (text, sha) => text.replace(/[0-9a-f]{40}/g, sha);
try {
  git('init');
  for (const file of ['adkill.js', 'adshield_stub.js']) fs.writeFileSync(path.join(root, file), `// ${file}\n`);
  git('add', '.');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture');
  const sha = git('rev-parse', 'HEAD'), mod = replaceSha(template, sha);
  assert.equal(validateRelease(root, mod, { requireWorkingTree: true }).length, 5);
  // Every individual stub reference must be checked, including the last one.
  for (let index = 0; index < 4; index++) {
    let n = 0;
    const changed = mod.replace(/@[0-9a-f]{40}/g, old => n++ === index ? '@' + '0'.repeat(40) : old);
    assert.throws(() => validateRelease(root, changed), /same reviewed commit/);
  }
  assert.throws(() => validateRelease(root, replaceSha(mod, '0'.repeat(40))), /unavailable/);
  assert.throws(() => validateRelease(root, mod.replace(/@[0-9a-f]{40}/, '@main')), /invalid/);
  assert.throws(() => validateRelease(root, mod.replace(/^.*adshield_stub.*302\n/m, '')), /four/);
  assert.throws(() => validateRelease(root, mod + '\n^https://extra/ https://cdn.example/stub.js 302\n'), /four/);
  fs.writeFileSync(path.join(root, 'adshield_stub.js'), '// unpinned change\n');
  assert.throws(() => validateRelease(root, mod, { requireWorkingTree: true }), /differs/);
  // A single common, existing SHA still fails when the stub file is missing there.
  git('rm', '-f', 'adshield_stub.js');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'missing stub');
  assert.throws(() => validateRelease(root, replaceSha(mod, git('rev-parse', 'HEAD'))), /unavailable/);
  console.log('all runtime references, missing commits/files and deployed byte equality: OK');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
