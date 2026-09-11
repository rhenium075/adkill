'use strict';
// Validate the effective configuration, not just the base profile.
const fs = require('fs');
const path = require('path');

function hostMatches(host, pattern) {
  return pattern.startsWith('*.')
    ? host.endsWith(pattern.slice(1)) && host !== pattern.slice(2)
    : host === pattern;
}

// Inspect every active row in a section, irrespective of its definition name.
// Duplicate sections are rejected instead of guessing the client's merge behavior.
function sectionRows(text, wanted) {
  let section = '', count = 0, invalidHeaders = false;
  const rows = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^[#;]/.test(line)) continue;
    const header = line.match(/^\[\s*([^\]]+?)\s*\]$/);
    if (header) {
      section = header[1].toLowerCase();
      if (section === wanted.toLowerCase()) count++;
    } else {
      if (line.startsWith('[')) invalidHeaders = true;
      if (section === wanted.toLowerCase()) rows.push(line);
    }
  }
  return { rows, count, invalidHeaders };
}

function validateConfig(conf, moduleText, policy) {
  const errors = [], positives = [], negatives = [], limits = policy.limits;
  for (const [name, text] of [['conf', conf], ['module', moduleText]]) {
    const rows = text.split(/\r?\n/).filter(l => /^\s*hostname\s*=/.test(l));
    if (rows.length !== 1) errors.push(`${name}: expected exactly one hostname row`);
    for (const row of rows) {
      if (Buffer.byteLength(row, 'utf8') > limits.hostnameBytes) errors.push(`${name}: hostname byte limit`);
      const value = row.slice(row.indexOf('=') + 1).trim();
      if (name === 'module' && !value.startsWith('%APPEND% ')) errors.push('module: hostname must append');
      const items = value.replace(/^%APPEND%\s*/, '').split(',').map(s => s.trim());
      if (items.length > limits.hostnameItems) errors.push(`${name}: hostname item limit`);
      for (const item of items) {
        if (!/^-?(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(item)) errors.push(`${name}: invalid hostname ${item}`);
        if (item.startsWith('-')) negatives.push(item.slice(1));
        else {
          positives.push(item);
          if (!policy.allowedMitmPatterns.includes(item)) errors.push(`${name}: unreviewed MITM host ${item}`);
        }
      }
    }
  }
  // The combined effective hostname must stay within the same conservative budget.
  const effective = positives.concat(negatives.map(s => '-' + s));
  if (Buffer.byteLength('hostname = ' + effective.join(', '), 'utf8') > limits.hostnameBytes) errors.push('effective hostname byte limit');
  if (effective.length > limits.hostnameItems) errors.push('effective hostname item limit');
  for (const pos of positives) {
    for (const neg of negatives) {
      const p = pos.replace(/^\*\./, ''), n = neg.replace(/^\*\./, '');
      if (pos === neg || hostMatches(p, neg) || hostMatches(n, pos) || p === n) errors.push(`conflicting MITM patterns: ${pos} / -${neg}`);
    }
  }
  const baseScripts = sectionRows(conf, 'Script'), scripts = sectionRows(moduleText, 'Script');
  if (baseScripts.invalidHeaders || scripts.invalidHeaders) errors.push('unsupported section header syntax');
  if (baseScripts.count > 1 || scripts.count !== 1) errors.push('duplicate or missing Script section');
  if (baseScripts.rows.length) errors.push('base conf must not define any scripts');
  if (scripts.rows.length !== 1 || !/^adkill\s*=/.test(scripts.rows[0] || '')) errors.push('expected exactly one adkill script and no other definitions');
  const fields = {};
  for (const field of (scripts.rows[0] || '').replace(/^adkill\s*=\s*/, '').split(',')) {
    const match = field.trim().match(/^([a-z-]+)=(.+)$/);
    if (!match || Object.hasOwn(fields, match[1])) { errors.push('invalid or duplicate script option'); continue; }
    fields[match[1]] = match[2];
  }
  const expected = { type: 'http-response', pattern: policy.bodyPattern, 'requires-body': '1',
    'max-size': '3145728', timeout: '30', 'script-update-interval': '86400' };
  for (const [key, value] of Object.entries(expected)) {
    if (fields[key] !== value) errors.push(key === 'pattern' ? 'body pattern differs from reviewed document policy' : `unreviewed script option: ${key}`);
  }
  if (Object.keys(fields).some(k => !Object.hasOwn(expected, k) && k !== 'script-path')) errors.push('unknown script option');
  if (!/^https:\/\/raw\.githubusercontent\.com\/rhenium075\/adkill\/[0-9a-f]{40}\/adkill\.js$/.test(fields['script-path'] || '')) errors.push('script-path must be a pinned repository script');
  if (Buffer.byteLength(fields.pattern || '', 'utf8') > limits.patternBytes) errors.push('body pattern byte limit');
  return errors;
}

if (require.main === module) {
  const root = path.join(__dirname, '..');
  const errors = validateConfig(fs.readFileSync(path.join(root, 'adkill.conf'), 'utf8'), fs.readFileSync(path.join(root, 'adkill_mitm.sgmodule'), 'utf8'), require('./mitm_policy.json'));
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log('effective configuration: OK');
}
module.exports = { validateConfig, hostMatches, sectionRows };
