'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { readPinnedScript, rewriteResponse, bodyCandidate } = require('./release_source');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adkill-release-'));
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
try {
  git('init');
  fs.writeFileSync(path.join(root, 'adkill.js'), 'pinned code');
  git('add', 'adkill.js');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture');
  const sha = git('rev-parse', 'HEAD');
  const moduleText = `adkill = script-path=https://raw.githubusercontent.com/rhenium075/adkill/${sha}/adkill.js, timeout=30`;
  fs.writeFileSync(path.join(root, 'adkill.js'), 'unreleased working copy');
  assert.equal(readPinnedScript(root, moduleText), 'pinned code');
  assert.throws(() => readPinnedScript(root, moduleText.replace(sha, '0'.repeat(40))), /unavailable/);
  assert.throws(() => readPinnedScript(root, moduleText.replace(sha, 'main')), /immutable/);
  assert.deepEqual(rewriteResponse({ status: 302, to: 'https://cdn.example/stub.js' }), { status: 302, headers: { location: 'https://cdn.example/stub.js' }, body: '' });
  for (const resourceType of ['document', 'image', 'fetch', 'eventsource']) {
    assert.equal(bodyCandidate({ url: 'https://example.com/image/1', canProcess: true, noInject: false, pattern: /^https:\/\/example.com\//, resourceType }), true);
  }
  assert.equal(bodyCandidate({ url: 'https://example.com/', canProcess: false, pattern: /.*/ }), false);
  console.log('pinned release source, real redirect and body-selection tests: OK');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
