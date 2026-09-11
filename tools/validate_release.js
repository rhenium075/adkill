'use strict';
// Validate every deployed runtime reference, not just the first adkill.js SHA.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { sectionRows } = require('./validate_config');

function releaseReferences(moduleText) {
  const scripts = sectionRows(moduleText, 'Script');
  const rewrites = sectionRows(moduleText, 'URL Rewrite');
  if (scripts.invalidHeaders || rewrites.invalidHeaders || scripts.count !== 1 || scripts.rows.length !== 1 || rewrites.count !== 1 || rewrites.rows.length !== 4) {
    throw new Error('expected one script and four reviewed stub rewrites');
  }
  const script = scripts.rows[0].match(/^adkill\s*=.*?\bscript-path=(https:\/\/raw\.githubusercontent\.com\/rhenium075\/adkill\/([0-9a-f]{40})\/adkill\.js)(?:,|$)/);
  if (!script) throw new Error('invalid pinned script reference');
  const refs = [{ sha: script[2], file: 'adkill.js', url: script[1] }];
  for (const row of rewrites.rows) {
    const match = row.match(/^\S+\s+(https:\/\/cdn\.jsdelivr\.net\/gh\/rhenium075\/adkill@([0-9a-f]{40})\/adshield_stub\.js)\s+302$/);
    if (!match) throw new Error('invalid pinned stub rewrite');
    refs.push({ sha: match[2], file: 'adshield_stub.js', url: match[1] });
  }
  if (refs.some(r => r.sha !== refs[0].sha)) throw new Error('runtime references must use the same reviewed commit');
  return refs;
}

function validateRelease(root, moduleText, { requireWorkingTree = false } = {}) {
  const refs = releaseReferences(moduleText);
  for (const { sha, file } of refs) {
    let pinned;
    try {
      pinned = execFileSync('git', ['-C', root, 'show', `${sha}:${file}`], { maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { throw new Error(`unavailable runtime reference: ${sha}:${file}; fetch full Git history`); }
    if (requireWorkingTree && !pinned.equals(fs.readFileSync(path.join(root, file)))) {
      throw new Error(`deployed ${file} differs from the tested working tree; pin the implementation commit`);
    }
  }
  return refs;
}

if (require.main === module) {
  const root = path.join(__dirname, '..');
  try {
    const refs = validateRelease(root, fs.readFileSync(path.join(root, 'adkill_mitm.sgmodule'), 'utf8'), { requireWorkingTree: true });
    console.log(`release: ${refs.length} references verified at ${refs[0].sha}; runtime bytes match working tree`);
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
module.exports = { releaseReferences, validateRelease };
