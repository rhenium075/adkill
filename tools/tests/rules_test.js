/*
 * rules_test.js — ルールファイルの構文検証・誤爆コーパス・対保守同期チェック
 */
'use strict';
const fs = require('fs');
const path = require('path');
const P = path.join(__dirname, '..', '..') + path.sep;

let pass = 0, fail = 0; const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}
const lines = (f) => fs.readFileSync(P + f, 'utf8').split(/\r?\n/);

// ---------------------------------------------------------------
console.log('[1] adkill_custom.list / adkill_jp.list の構文');
const VALID_TYPES = new Set(['DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'URL-REGEX', 'USER-AGENT', 'IP-CIDR', 'IP-CIDR6']);
const DOM_OK = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
for (const file of ['adkill_custom.list', 'adkill_jp.list']) {
  const bad = [];
  const regexes = [];
  for (const [i, raw] of lines(file).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    const idx = line.indexOf(',');
    if (idx < 0) { bad.push(`${i + 1}: カンマなし: ${line}`); continue; }
    const type = line.slice(0, idx);
    const val = line.slice(idx + 1);
    if (!VALID_TYPES.has(type)) { bad.push(`${i + 1}: 不明なタイプ ${type}`); continue; }
    if (type === 'URL-REGEX') {
      try { regexes.push([i + 1, new RegExp(val)]); } catch (e) { bad.push(`${i + 1}: 正規表現エラー: ${e.message}`); }
      continue;
    }
    if (type.startsWith('DOMAIN') && type !== 'DOMAIN-KEYWORD') {
      if (val.includes(',')) { bad.push(`${i + 1}: RULE-SET 内にポリシー付与 (conf 側で付くため二重): ${line}`); continue; }
      if (!DOM_OK.test(val)) bad.push(`${i + 1}: 不正なドメイン: ${val}`);
    }
  }
  check(`${file}: 全行が妥当な構文`, bad.length === 0, bad.slice(0, 5).join(' | '));
}

console.log('[2] URL-REGEX の挙動コーパス (adkill_custom.list)');
{
  const regexes = lines('adkill_custom.list')
    .map(l => l.trim()).filter(l => l.startsWith('URL-REGEX,'))
    .map(l => l.slice('URL-REGEX,'.length))
    .map(src => ({ src, re: new RegExp(src) }));
  const anyMatch = (url) => regexes.filter(r => r.re.test(url)).map(r => r.src);

  const SHOULD_BLOCK = [
    'https://ads.example.com/serve',
    'https://pagead.example.jp/x',
    'https://atzzrq.tbs.co.jp/track',
    'https://cdn.site.com/js/blockadblock.min.js',
    'https://site.com/assets/adblock-detector.min.js?v=2',
    'https://site.com/static/gpt.js',
    'https://site.com/ads.js',
    'https://site.com/path/to/ads.js?x=1',
    'https://cdn.site.com/prebid8.28.0.js',
    // Ad-Shield 第一者偽装ローダー
    'https://loader.example.com/loader.min.js',
    'https://as.example.jp/script/www.example.jp.js',
    'https://shieldload.news-site.com/loader.min.js?v=3',
  ];
  const SHOULD_PASS = [
    'https://github.com/reek/anti-adblock-killer',                 // OSS リポジトリページ
    'https://news.example.com/2026/how-adblock-detection-works',   // adblock を語る記事
    'https://blog.example.jp/entry/detect-adblock-no-shikumi',     // 同上
    'https://example.com/heads.js',                                // ads.js に似た別ファイル
    'https://example.com/downloads.json',                          // "ads" を含むだけのパス
    'https://example.com/gadgets/gpt.json',                        // gpt.js でない
    'https://adventure.example.com/',                              // ad で始まるが広告でないホスト
    'https://address.example.com/',                                // 同上
    'https://adsl-support.example.jp/',                            // "ads" 前方一致だが直後にドットがない
    'https://loader.example.com/app.js',                           // loader. ホストでも別ファイルは通す
    'https://cdn.mycompany.com/loader.min.js',                     // 対象プレフィックス以外の loader.min.js は通す
    'https://assets.example.com/script/main.js',                   // assets. は as. にマッチしない
    'https://download.example.com/script/setup.js',                // download. は load. にマッチしない
  ];
  for (const u of SHOULD_BLOCK) {
    const m = anyMatch(u);
    check(`ブロックされる: ${u}`, m.length > 0);
  }
  for (const u of SHOULD_PASS) {
    const m = anyMatch(u);
    check(`素通しされる: ${u}`, m.length === 0, 'マッチした規則: ' + m.join(' ; '));
  }
}

console.log('[3] adkill_custom.list と adguard_dns_userrules.txt の対保守同期');
{
  const custom = new Set(
    lines('adkill_custom.list').map(l => l.trim())
      .filter(l => /^DOMAIN(-SUFFIX)?,/.test(l))
      .map(l => l.split(',')[1])
  );
  const dnsTxt = lines('adguard_dns_userrules.txt');
  const dns = new Set(
    dnsTxt.map(l => l.trim())
      .filter(l => /^\|\|[a-z0-9.-]+\^$/.test(l))
      .map(l => l.slice(2, -1))
  );
  const dnsRegexPrefixes = ['ads', 'ad', 'adx', 'adv', 'adserver', 'adservice', 'pagead', 'sspad'];
  const coveredByDns = (d) => {
    if (dns.has(d)) return true;
    // 上位ドメインが登録済みなら包含される
    const parts = d.split('.');
    for (let i = 1; i < parts.length - 1; i++) if (dns.has(parts.slice(i).join('.'))) return true;
    // DNS 側の正規表現 (/^ad[sxv]?\./ 等) でカバーされるか
    const head = d.split('.')[0];
    if (dnsRegexPrefixes.includes(head)) return true;
    return false;
  };
  const missing = [...custom].filter(d => !coveredByDns(d));
  check('custom.list の全ドメインが DNS 側でもカバーされる', missing.length === 0,
    'DNS 側に無い: ' + missing.join(', '));
}

console.log('[4] adkill.conf の妥当性');
{
  const conf = fs.readFileSync(P + 'adkill.conf', 'utf8');
  const confLines = conf.split(/\r?\n/);
  check('ca-p12 / ca-passphrase を含まない (秘密鍵の公開禁止)', !/^\s*(ca-p12|ca-passphrase)\s*=/m.test(conf));
  check('[Script] の script-path が raw.githubusercontent.com/rhenium075/adkill を指す',
    /script-path=https:\/\/raw\.githubusercontent\.com\/rhenium075\/adkill\/main\/adkill\.js/.test(conf));
  check('FINAL ルールがある', /^FINAL,/m.test(conf));
  const ruleSets = confLines.filter(l => l.trim().startsWith('RULE-SET,'));
  check('RULE-SET は全て https + ポリシー付き', ruleSets.every(l => {
    const parts = l.trim().split(',');
    return parts.length === 3 && parts[1].startsWith('https://') && parts[2].length > 0;
  }));
  // FINAL より後に評価されないこと: FINAL が [Rule] セクションの最後のルール行か
  const ruleSecStart = confLines.findIndex(l => l.trim() === '[Rule]');
  const nextSec = confLines.findIndex((l, i) => i > ruleSecStart && /^\[.+\]$/.test(l.trim()));
  const ruleBody = confLines.slice(ruleSecStart + 1, nextSec).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
  check('FINAL が [Rule] の最終行', ruleBody[ruleBody.length - 1].startsWith('FINAL,'));
  // MITM hostname の除外が sgmodule 側と矛盾しないか(conf の除外は conf 内で完結しているか)
  const mitm = (conf.match(/^hostname = (.+)$/m) || [])[1] || '';
  const items = mitm.split(',').map(s => s.trim()).filter(Boolean);
  const badItems = items.filter(s => !/^-?\*?[a-z0-9.*-]+$/i.test(s));
  check('MITM hostname の項目が全て妥当な形', badItems.length === 0, badItems.join(', '));
  const wildTlds = items.filter(s => /^\*\./.test(s) === false && s.startsWith('*'));
  check('MITM に包括ワイルドカード (*.tld 形式) がある', items.some(s => /^\*\.[a-z]+$/.test(s)));
}

console.log('[5] adkill_mitm.sgmodule の妥当性');
{
  const mod = fs.readFileSync(P + 'adkill_mitm.sgmodule', 'utf8');
  check('%APPEND% を使っている', /hostname\s*=\s*%APPEND%/.test(mod));
  const hosts = ((mod.match(/%APPEND%\s*(.+)$/m) || [])[1] || '').split(',').map(s => s.trim());
  check('全て "-" 除外指定である', hosts.every(h => h.startsWith('-')), hosts.filter(h => !h.startsWith('-')).join(','));
  check('newsdig が除外されていない (ECH 誤診の解消で MITM 復活済み)', !hosts.some(h => h === '-newsdig.tbs.co.jp'));
}

console.log('---------------------------------------------');
console.log(`pass=${pass} fail=${fail}`);
if (failures.length) { console.log('FAILURES:'); failures.forEach(f => console.log(' - ' + f)); process.exitCode = 1; }
