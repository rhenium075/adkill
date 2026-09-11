'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { validateConfig } = require('../validate_config');
const policy = require('../mitm_policy.json');
const root = path.join(__dirname, '../..');
const conf = fs.readFileSync(path.join(root, 'adkill.conf'), 'utf8');
const mod = fs.readFileSync(path.join(root, 'adkill_mitm.sgmodule'), 'utf8');
assert.deepEqual(validateConfig(conf, mod, policy), []);
const extra = 'extra = type=http-response, pattern=^https?://.+, requires-body=1, script-path=https://example.com/script.js\n';
for (const row of [extra, '  ' + extra, extra.replace('extra', 'renamed'), 'not a script definition\n']) {
  assert.ok(validateConfig(conf.replace(/^\[Script\]$/m, '[Script]\n' + row), mod, policy).length);
  assert.ok(validateConfig(conf, mod.replace(/^\[Script\]$/m, '[Script]\n' + row), policy).length);
}
assert.ok(validateConfig(conf, mod + '\n[Script]\n' + extra, policy).length);
assert.ok(validateConfig(conf + '\n[Script] # ambiguous header\n' + extra, mod, policy).length);
assert.ok(validateConfig(conf, mod + '\n[Script] # ambiguous header\n' + extra, policy).length);
assert.ok(validateConfig(conf, mod.replace(/^\[Script\]$/m, '[script]\n' + extra), policy).length);
assert.ok(validateConfig(conf, mod.replace('requires-body=1', 'requires-body=1, requires-body=0'), policy).length);
assert.ok(validateConfig(conf, mod.replace('timeout=30', 'timeout=999'), policy).length);
assert.ok(validateConfig(conf, mod.replace('timeout=30', 'timeout=30, unknown=1'), policy).length);
assert.deepEqual(validateConfig(conf, mod.replace('adkill =', '  adkill ='), policy), []);
for (const host of ['*.com', '*.technology', '*.co.jp', '*', 'claude.ai', 'api.openai.com']) {
  const changed = mod.replace('hostname = %APPEND% ', `hostname = %APPEND% ${host}, `);
  assert.ok(validateConfig(conf, changed, policy).length, `module addition must fail: ${host}`);
  assert.ok(validateConfig(conf.replace('hostname = ', `hostname = ${host}, `), mod, policy).length, `conf addition must fail: ${host}`);
}
assert.ok(validateConfig(conf, mod.replace('hostname = %APPEND% ', 'hostname = %APPEND% -example.com, '), policy).some(e => e.includes('conflicting')));
assert.ok(validateConfig(conf, mod.replace('hostname = %APPEND% ', 'hostname = %APPEND% ' + 'example.com, '.repeat(201)), policy).some(e => e.includes('item limit')));
// Individually legal lengths still must not exceed the combined budget.
const repeated = conf.replace(/hostname = .*/, 'hostname = ' + Array(190).fill('example.com').join(', '));
assert.ok(validateConfig(repeated, mod, policy).some(e => e.includes('effective hostname item limit')));
assert.ok(validateConfig(conf, mod + '\nhostname = %APPEND% example.com\n', policy).length);
assert.ok(validateConfig(conf, mod.replace(/pattern=[^,]+,/, 'pattern=^https://.+,'), policy).some(e => e.includes('body pattern')));
const body = new RegExp(policy.bodyPattern);
for (const url of ['https://trafficnews.jp/', 'https://trafficnews.jp/post/706678', 'https://trafficnews.jp/post/706678/2', 'https://trafficnews.jp/category/railway', 'https://example.com/', 'http://neverssl.com/']) assert.ok(body.test(url), url);
for (const url of ['https://trafficnews.jp/api/events', 'https://trafficnews.jp/image/123', 'https://trafficnews.jp/login', 'https://trafficnews.jp/post/1/image', 'https://api.trafficnews.jp/', 'https://unknown.example/', 'https://example.com/events', 'http://trafficnews.jp/', 'http://example.com/', 'http://blog.livedoor.jp/x.html', 'https://trafficnews.jp.evil.example/']) assert.ok(!body.test(url), url);
console.log('configuration mutation and document-boundary tests: OK');
