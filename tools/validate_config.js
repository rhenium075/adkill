'use strict';
// Validate the effective configuration, not just the base profile.
const fs = require('fs');
const path = require('path');

function hostMatches(host, pattern) {
  return pattern.startsWith('*.')
    ? host.endsWith(pattern.slice(1)) && host !== pattern.slice(2)
    : host === pattern;
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
  const scriptRows = moduleText.split(/\r?\n/).filter(l => /^adkill\s*=/.test(l));
  if (scriptRows.length !== 1) errors.push('expected exactly one adkill script');
  const pattern = (scriptRows[0] || '').match(/pattern=([^,]+),/);
  if (!pattern || pattern[1] !== policy.bodyPattern) errors.push('body pattern differs from reviewed document policy');
  if (pattern && Buffer.byteLength(pattern[1], 'utf8') > limits.patternBytes) errors.push('body pattern byte limit');
  if (/^adkill\s*=/m.test(conf)) errors.push('base conf must not define adkill script');
  return errors;
}

if (require.main === module) {
  const root = path.join(__dirname, '..');
  const errors = validateConfig(fs.readFileSync(path.join(root, 'adkill.conf'), 'utf8'), fs.readFileSync(path.join(root, 'adkill_mitm.sgmodule'), 'utf8'), require('./mitm_policy.json'));
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log('effective configuration: OK');
}
module.exports = { validateConfig, hostMatches };
