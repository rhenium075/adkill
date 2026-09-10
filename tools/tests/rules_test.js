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
    // Ad-Shield 配信ドメインの loader 以外は遮断
    'https://html-load.com/l/beacon',
    'https://content-loader.com/script/x.js',
    'https://fb.html-load.com/anything',
    'https://role.nicelyfrom.com/beacon',
    'https://d3athhgvypbrtj.cloudfront.net/telemetry',
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
    // loader.min.js / sdk.js は [URL Rewrite] でスタブに差し替えるため、ルールでは遮断しない
    'https://html-load.com/loader.min.js',
    'https://fb.content-loader.com/loader.min.js?x=1',
    'https://role.nicelyfrom.com/sdk.js',
    'https://d3athhgvypbrtj.cloudfront.net/sdk.js',
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
  // 更新経路の固定: conf は実行コードを参照せず、モジュール側で完全 SHA に固定する
  check('conf に実行コード ([Script] adkill 行) が無い', !/^adkill = /m.test(conf));
  const modTxt = fs.readFileSync(P + 'adkill_mitm.sgmodule', 'utf8');
  check('モジュールの adkill.js 参照が完全 SHA 固定',
    /script-path=https:\/\/raw\.githubusercontent\.com\/rhenium075\/adkill\/[0-9a-f]{40}\/adkill\.js/.test(modTxt));
  check('モジュールのスタブ参照が完全 SHA 固定 (@main なし)',
    /@[0-9a-f]{40}\/adshield_stub\.js/.test(modTxt) && !/@main\/adshield_stub\.js/.test(modTxt));
  check('実行コードへの main 参照が conf/モジュールに無い',
    !/main\/adkill\.js|@main\/adshield_stub\.js/.test(conf + modTxt));
  // 固定 SHA のコミットに実際に両ファイルが存在する (参照切れ防止)
  {
    const sha = (modTxt.match(/rhenium075\/adkill\/([0-9a-f]{40})\/adkill\.js/) || [])[1];
    let ok = false;
    try {
      require('child_process').execFileSync('git', ['-C', P, 'cat-file', '-e', `${sha}:adkill.js`]);
      require('child_process').execFileSync('git', ['-C', P, 'cat-file', '-e', `${sha}:adshield_stub.js`]);
      ok = true;
    } catch (e) {}
    check('固定 SHA のコミットに adkill.js / adshield_stub.js が存在する', ok, `sha=${sha}`);
  }
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
  // 2026-09-10: 包括ワイルドカード方式は廃止 (requires-body と組み合わさると
  // Connection:close サイト・拡張子なし画像・API/SSE を壊すため)。許可リスト方式を強制する
  const broadWild = items.filter(s => /^\*\.[a-z]{2,6}$/.test(s) || s === '*');
  check('包括ワイルドカード (*.tld / *) が存在しない (許可リスト方式)', broadWild.length === 0, broadWild.join(', '));
  check('TINYGIF 偽装に必要な広告ドメインが MITM 対象', ['*.googlesyndication.com', '*.doubleclick.net', 'fundingchoicesmessages.google.com', '*.npttech.com'].every(d => items.includes(d)));
  check('Ad-Shield スタブ差し替えに必要なドメインが MITM 対象', ['html-load.com', 'fb.html-load.com', 'content-loader.com', 'fb.content-loader.com'].every(d => items.includes(d)));
  check('バッジ検証用ホストが MITM 対象', items.includes('example.com'));
  const risky = items.filter(s => /(apple|icloud|line\.me|paypay|mufg|smbc|mizuho|japanpost|stripe|anthropic|openai|chatgpt|claude|googleapis|googleusercontent|ggpht|livedoor|fnn)/.test(s) && !s.startsWith('-'));
  check('アプリ/金融/API 系ドメインを復号対象にしていない', risky.length === 0, risky.join(', '));
}

console.log('[4.5] [Script] pattern (文書 URL のみにマッチし、静的アセットを除外する)');
{
  // [Script] はモジュール側に移動済み (更新経路の固定)
  const modSrc = fs.readFileSync(P + 'adkill_mitm.sgmodule', 'utf8');
  const m = modSrc.match(/^adkill = .*?pattern=([^,]+),/m);
  check('[Script] の pattern が取得できる (モジュール側)', !!m);
  const re = new RegExp(m[1]);
  // (第9報) pattern は広域 (未知ホストの文書も注入対象)。
  // ただし実測で壊れると確定したクラス (close / Shift_JIS) と /api/・/graphql/ はホスト・パス除外
  const DOCS = [
    'https://example.com', 'https://example.com/', 'https://www.example.com/news/article-123',
    'https://example.org/page.html', 'http://neverssl.com/',
    'https://trafficnews.jp/', 'https://trafficnews.jp/post/525346',
    'https://example.com/watch?v=abc', 'https://example.com/app.aspx',
    'https://jetstream.blog/google-preferences-source/',
    'https://rocketnews24.com/', 'https://weathernews.jp/',
    'https://www.publickey1.jp/2026/09/article.html', 'https://b.hatena.ne.jp/hotentry/all',
    // 未知ホストも文書なら注入対象 (第9報の本質)
    'https://hamusoku.com/',
    'https://www.google.com/search?q=abc', 'http://blog.example.jp/entry/123',
    // 施行 CSP サイトは pattern にはマッチする (実行時の CSP 保持ガードが注入を見送る)
    'https://ameblo.jp/', 'https://note.com/',
  ];
  const DENIED_DOCS = [
    // Connection: close (応答死クラス — 実測)
    'http://blog.livedoor.jp/glintbooster/archives/48412446.html',
    'https://blog.livedoor.com/',
    'https://newsdig.tbs.co.jp/articles/gallery/2669579',
    'https://www.fnn.jp/', 'https://toyokeizai.net/',
    // Shift_JIS (SR のバッファが非 UTF-8 を破壊しうる — 実測)
    'https://www.itmedia.co.jp/', 'https://kakaku.com/', 'https://itest.5ch.net/',
    // SPA ロード順に敏感 (安全側の除外。実機検証後に解除検討)
    'https://www.nicovideo.jp/',
    // SSE/ストリーミングを巻き込まないための /api/・/graphql/ 除外
    'https://example.com/api/v1/messages', 'https://foo.jp/graphql',
    'https://site.com/app/api/stream',
  ];
  for (const u of DENIED_DOCS) check(`除外クラスは処理しない: ${u}`, !re.test(u));

  // 監査 F3: モジュール [URL Rewrite] と custom.list の遮断除外は対で保守される。
  // 「除外だけ効いてリライトが無い」壊れ方を機械検出する:
  // ルールで素通しになる Ad-Shield 実行ファイル URL は、必ずモジュールのリライトが受け止めること
  {
    const rewrites = [];
    const sec = modSrc.split(/^\[URL Rewrite\]$/m)[1] || '';
    for (const raw of sec.split(/^\[/m)[0].split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const mm = line.match(/^(\S+)\s+\S+\s+(?:302|307|header)$/) || line.match(/^(\S+)\s+-\s+reject$/);
      if (mm) { try { rewrites.push(new RegExp(mm[1])); } catch (e) {} }
    }
    const ADSHIELD_EXEC = [
      'https://html-load.com/loader.min.js', 'https://fb.content-loader.com/loader.min.js',
      'https://html-load.com/sdk.js', 'https://fb.content-loader.com/sdk.js',
      'https://role.nicelyfrom.com/sdk.js', 'https://d3athhgvypbrtj.cloudfront.net/sdk.js',
    ];
    for (const u of ADSHIELD_EXEC) {
      check(`遮断除外された実行ファイルにリライトが対応: ${u}`, rewrites.some((r) => r.test(u)));
    }
  }
  const ASSETS = [
    'https://jetstream.blog/wp-content/uploads/2026/09/logo.png',
    'https://example.com/icon.svg', 'https://example.com/style.css?v=3',
    'https://example.com/app.js', 'https://example.com/font.woff2',
    'https://example.com/photo.jpeg', 'https://example.com/movie.mp4',
    'https://example.com/data.json', 'https://example.com/pic.webp?x=1',
    'https://cdn.example.com/a/b/c/thumb.avif', 'https://example.com/archive.zip',
  ];
  for (const u of DOCS) check(`文書として処理される: ${u}`, re.test(u));
  for (const u of ASSETS) check(`スクリプトを通さない: ${u}`, !re.test(u));
}

console.log('[5] adkill_mitm.sgmodule の妥当性');
{
  const mod = fs.readFileSync(P + 'adkill_mitm.sgmodule', 'utf8');
  check('%APPEND% を使っている', /hostname\s*=\s*%APPEND%/.test(mod));
  const hosts = ((mod.match(/%APPEND%\s*(.+)$/m) || [])[1] || '').split(',').map(s => s.trim());
  // 2026-09-10 以降: 正の項目 (復号対象の追加) と "-" 除外が混在する運用
  check('全項目が妥当なホスト形式', hosts.every(h => /^-?(\*\.)?[a-z0-9.*-]+$/i.test(h)), hosts.filter(h => !/^-?(\*\.)?[a-z0-9.*-]+$/i.test(h)).join(','));
  // (第9報) 広域 MITM: include は TLD ワイルドカード、危険系は AdGuard 公開 DB + 実測分で除外
  check('広域 include (*.com / *.jp) がモジュールにある', hosts.includes('*.com') && hosts.includes('*.jp'));
  check('AI アシスタント API が除外されている', ['-anthropic.com', '-*.claude.ai', '-*.openai.com'].every(d => hosts.includes(d)));
  check('金融・決済が除外されている', ['-*.mufg.jp', '-*.paypay.ne.jp', '-*.smbc.co.jp'].every(d => hosts.includes(d)));
  check('メッセージング・ピンニング系が除外されている', ['-*.line.me', '-*.apple.com', '-*.googleapis.com', '-*.twimg.com'].every(d => hosts.includes(d)));
  check('EC 購入導線が除外されている', ['-*.amazon.co.jp', '-*.mercari.com', '-*.rakuten.co.jp'].every(d => hosts.includes(d)));
  check('広告スタックは除外されていない (TINYGIF に必要)', !hosts.some(h => /^-(\*\.)?(googlesyndication\.com|doubleclick\.net|googletagmanager\.com|html-load\.com|nicelyfrom\.com)$/.test(h)));
  check('Ad-Shield sdk/loader 配信ドメインは広域 include (*.com/*.net) で復号対象', hosts.includes('*.com') && hosts.includes('*.net'));
  // (第9報) newsdig は MITM 可 (SR ログで復号成功を確認済み)。危険なのはバッファリング
  // (Connection:close 応答死) なので、MITM 除外ではなく [Script] pattern のホスト除外で守る
  check('newsdig は MITM 除外ではなく [Script] pattern 除外で守られている',
    !hosts.some(h => h === '-newsdig.tbs.co.jp') && /newsdig\\\.tbs\\\.co\\\.jp/.test(mod));
}

console.log('---------------------------------------------');
console.log(`pass=${pass} fail=${fail}`);
if (failures.length) { console.log('FAILURES:'); failures.forEach(f => console.log(' - ' + f)); process.exitCode = 1; }
