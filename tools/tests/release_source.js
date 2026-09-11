'use strict';
const { execFileSync } = require('child_process');
const { sectionRows } = require('../validate_config');

function readPinnedScript(root, moduleText) {
  const { rows, count, invalidHeaders } = sectionRows(moduleText, 'Script');
  if (invalidHeaders || count !== 1 || rows.length !== 1 || !/^adkill\s*=/.test(rows[0])) throw new Error('expected one adkill script');
  const match = rows[0].match(/script-path=https:\/\/raw\.githubusercontent\.com\/rhenium075\/adkill\/([0-9a-f]{40})\/adkill\.js(?:,|$)/);
  if (!match) throw new Error('adkill script must use an immutable repository commit');
  try {
    return execFileSync('git', ['-C', root, 'show', `${match[1]}:adkill.js`], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    throw new Error(`pinned script ${match[1]} is unavailable; fetch repository history before emulation`);
  }
}

function rewriteResponse(rule) {
  if (rule.reject) return null;
  return { status: rule.status, headers: { location: rule.to }, body: '' };
}

function bodyCandidate({ url, canProcess, noInject, pattern }) {
  // Resource type must not hide a URL matched by Shadowrocket's pattern.
  return !noInject && canProcess && pattern.test(url);
}
module.exports = { readPinnedScript, rewriteResponse, bodyCandidate };
