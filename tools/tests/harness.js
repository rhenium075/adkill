/*
 * harness.js — Shadowrocket http-response 疑似環境
 * $request / $response / $done をモックして adkill.js を vm で実行し、
 * 書き換え結果を検証する。
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SCRIPT_PATH = process.argv[2] || path.join(__dirname, '..', '..', 'adkill.js');
const src = fs.readFileSync(SCRIPT_PATH, 'utf8');

function runScript(reqUrl, response) {
  let result = null;
  let doneCalls = 0;
  const ctx = {
    $request: { url: reqUrl },
    $response: response,
    $done: (r) => { doneCalls++; result = r; },
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'adkill.js', timeout: 5000 });
  return { result, doneCalls };
}

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

const HTML = (extra) => `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>t</title>${extra || ''}</head><body><p>hello</p></body></html>`;

// ---------------------------------------------------------------
console.log('[1] 基本注入 (text/html, <head> あり)');
{
  const { result, doneCalls } = runScript('https://example.com/page', {
    body: HTML(),
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': '999', 'Content-Encoding': 'br' },
  });
  check('$done は1回だけ呼ばれる', doneCalls === 1);
  check('body が返る', result && typeof result.body === 'string');
  const b = result.body || '';
  check('CSS が注入される', b.includes('__adkill_css'));
  check('JS が注入される', b.includes('__adkill_js'));
  check('注入位置は <head> 直後', /<head>\s*<style id="__adkill_css">/.test(b) || b.indexOf('__adkill_css') > b.indexOf('<head>'));
  const hdrs = result.headers || {};
  const hkeys = Object.keys(hdrs).map(k => k.toLowerCase());
  check('Content-Length が除去される(改変後の不整合防止)', !hkeys.includes('content-length'));
  check('Content-Encoding が除去される(復号済みbodyとの不整合防止)', !hkeys.includes('content-encoding'));
}

console.log('[2] CSP 保持ポリシー (R02: 施行 CSP のあるページは注入せず CSP を残す)');
{
  const enforced = runScript('https://example.com/', {
    body: HTML(), headers: { 'content-type': 'text/html', 'content-security-policy': "script-src 'self'" },
  });
  check('施行 CSP ヘッダあり → 注入しない (無変更)', enforced.result && enforced.result.body === undefined);
  const metaCsp = runScript('https://example.com/', {
    body: HTML('<meta http-equiv="Content-Security-Policy" content="default-src \'self\'">'),
    headers: { 'content-type': 'text/html' },
  });
  check('meta CSP あり → 注入しない (無変更)', metaCsp.result && metaCsp.result.body === undefined);
  const reportOnly = runScript('https://example.com/', {
    body: HTML(), headers: { 'content-type': 'TEXT/HTML', 'CONTENT-SECURITY-POLICY-REPORT-ONLY': 'x' },
  });
  check('Report-Only のみ → 注入する (遮断されないため)', reportOnly.result && reportOnly.result.body && reportOnly.result.body.includes('__adkill_css'));
  const roKeys = Object.keys(reportOnly.result.headers || {}).map(k => k.toLowerCase());
  check('Report-Only ヘッダは保持される', roKeys.includes('content-security-policy-report-only'));
}

console.log('[3] 非対象応答はそのまま通す');
{
  const j = runScript('https://example.com/api', { body: '{"a":1}', headers: { 'content-type': 'application/json' } });
  check('JSON は無変更 ($done({}))', j.result && j.result.body === undefined);
  const nob = runScript('https://example.com/x', { body: null, headers: {} });
  check('body なしは無変更', nob.result && nob.result.body === undefined);
  const frag = runScript('https://example.com/frag', { body: '<div>partial</div>', headers: { 'content-type': 'text/html' } });
  check('HTML断片(html/head/bodyなし)は無変更', frag.result && frag.result.body === undefined);
  const dup = runScript('https://example.com/', { body: HTML('<style id="__adkill_css"></style>'), headers: { 'content-type': 'text/html' } });
  check('二重注入しない', dup.result && dup.result.body === undefined);
  const noct = runScript('https://example.com/', { body: HTML(), headers: {} });
  check('content-type なしは無変更', noct.result && noct.result.body === undefined);
  const moji = runScript('https://example.com/', { body: HTML('<p>' + '�'.repeat(20) + '</p>'), headers: { 'content-type': 'text/html' } });
  check('U+FFFD が多い(誤デコードされた)文書は無変更', moji.result && moji.result.body === undefined);
}

console.log('[4] SKIP_HOSTS / LITE_HOSTS');
{
  const s1 = runScript('https://accounts.google.com/signin', { body: HTML(), headers: { 'content-type': 'text/html' } });
  check('SKIP_HOSTS 完全一致で注入しない', s1.result && s1.result.body === undefined);
  const s2 = runScript('https://sub.accounts.google.com/x', { body: HTML(), headers: { 'content-type': 'text/html' } });
  check('SKIP_HOSTS サブドメインでも注入しない', s2.result && s2.result.body === undefined);
  const s3 = runScript('https://notaccounts.google.com.evil.example/x', { body: HTML(), headers: { 'content-type': 'text/html' } });
  check('似た別ホストはスキップされない(注入される)', s3.result && typeof s3.result.body === 'string');
  const l1 = runScript('https://newsdig.tbs.co.jp/articles/1', { body: HTML(), headers: { 'content-type': 'text/html' } });
  check('newsdig は full 注入 (Admiral 対策に JS が必須のため LITE から除外済み)',
    l1.result && l1.result.body.includes('__adkill_css') && l1.result.body.includes('__adkill_js'));
  const p1 = runScript('https://example.com:8443/x', { body: HTML(), headers: { 'content-type': 'text/html' } });
  check('ポート付き URL でもホスト判定できる', p1.result && typeof p1.result.body === 'string');
}

console.log('[5] 注入位置のフォールバック');
{
  const noHead = runScript('https://example.com/', { body: '<html><body class="x"><p>a</p></body></html>', headers: { 'content-type': 'text/html' } });
  check('<head>なし→<body>直後に注入', noHead.result && /<body class="x"><style id="__adkill_css">/.test(noHead.result.body));
  const onlyHtml = runScript('https://example.com/', { body: '<html ><p>a</p></html>', headers: { 'content-type': 'text/html' } });
  check('<head>/<body>なし→先頭に注入', onlyHtml.result && onlyHtml.result.body.startsWith('<style id="__adkill_css">'));
  // <header> トラップ: <head> が無く <header> だけある HTML5 文書
  const headerTrap = runScript('https://example.com/', {
    body: '<html><body><header class="site-header"><h1>t</h1></header><p>a</p></body></html>',
    headers: { 'content-type': 'text/html' },
  });
  const hb = headerTrap.result && headerTrap.result.body || '';
  check('<header> を <head> と誤認しない', !/<header class="site-header"><style/.test(hb),
    '<header ...> 直後に注入されている');
  // 属性値に ">" を含まない一般的な <head lang> 形
  const headAttr = runScript('https://example.com/', { body: '<html><head data-x="1"><title>t</title></head><body></body></html>', headers: { 'content-type': 'text/html' } });
  check('<head 属性付き> にも注入', headAttr.result && /<head data-x="1"><style id="__adkill_css">/.test(headAttr.result.body));
}

console.log('[5.5] Ad-Shield スクリプトの HTML 除去');
{
  // data-sdk loader (onload アンチタンパー込み) + 独立復旧スクリプト
  const adshieldHtml = '<html><head><title>t</title></head><body><main id="c"><p>本文</p></main>'
    + '<script async id="RdOsS" data-sdk="l/1.2.3" data-cfasync="false" nowprocket src="https://html-load.com/sdk.js" onload="(()=>{var e,t,o,r,i=(o,r,i)=>{for(r=r||o.length,i=i||r;;)break;return e}})()"></script>'
    + '<script data-cfasync="false" nowprocket>(()=>{var e,r,t,o,i=(t,o,i)=>{for(o=o||t.length,i=i||o;;)break;return e};i()})()</script>'
    + '<script>window.legit=1</script></body></html>';
  const r = runScript('https://trafficnews.jp/', { body: adshieldHtml, headers: { 'content-type': 'text/html' } });
  check('data-sdk loader スクリプトが除去される', r.result && !/data-sdk="l\//.test(r.result.body));
  check('onload アンチタンパーごと消える', r.result && !/onload="\(\(\)=>\{var e,t,o,r/.test(r.result.body));
  check('nowprocket 独立復旧スクリプトが除去される', r.result && (r.result.body.match(/nowprocket/g) || []).length === 0);
  check('正当なスクリプトは残る', r.result && r.result.body.includes('window.legit=1'));
  check('本文は残る', r.result && r.result.body.includes('本文'));
  // 誤爆ガード: nowprocket だが Ad-Shield 難読化でない (WP Rocket 正当除外)
  const legit = '<html><head><title>t</title></head><body><p>x</p>'
    + '<script data-cfasync="false" nowprocket>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}</script></body></html>';
  const r2 = runScript('https://example.com/', { body: legit, headers: { 'content-type': 'text/html' } });
  check('nowprocket でも難読化非該当なら残す (誤爆しない)', r2.result && r2.result.body.includes('dataLayer'));
}

console.log('[6] 置換の安全性 (特殊文字 $&)');
{
  const tricky = runScript('https://example.com/', { body: '<html><head><script>var s="$&$`$\'";</script></head><body></body></html>', headers: { 'content-type': 'text/html' } });
  check('body 内の $& が壊れない', tricky.result && tricky.result.body.includes('var s="$&$`$\'";'));
}

console.log('[7] ペイロードは ASCII のみ (Shift_JIS ページ安全性)');
{
  const { result } = runScript('https://example.com/', { body: HTML(), headers: { 'content-type': 'text/html' } });
  const injected = result.body.replace(HTML(), '');
  let nonAscii = [];
  for (let i = 0; i < injected.length; i++) if (injected.charCodeAt(i) > 127) nonAscii.push(injected[i]);
  check('注入ペイロードが非ASCIIを含まない', nonAscii.length === 0, '含まれる文字: ' + [...new Set(nonAscii)].join(''));
}

console.log('[8] 注入される JS が構文的に valid');
{
  const { result } = runScript('https://example.com/', { body: HTML(), headers: { 'content-type': 'text/html' } });
  const m = result.body.match(/<script id="__adkill_js">([\s\S]*?)<\/script>/);
  check('script タグが閉じている', !!m);
  if (m) {
    let ok = true, err = '';
    try { new Function(m[1]); } catch (e) { ok = false; err = e.message; }
    check('注入 JS がパース可能', ok, err);
  }
  const cm = result.body.match(/<style id="__adkill_css">([\s\S]*?)<\/style>/);
  check('style タグが閉じている', !!cm);
  if (cm) {
    const css = cm[1];
    const open = (css.match(/{/g) || []).length, close = (css.match(/}/g) || []).length;
    check('CSS の波括弧が対応', open === close, `{=${open} }=${close}`);
    check('CSS にセレクタ末尾カンマ残りがない', !/,\s*{/.test(css));
  }
}

console.log('[9] $request が無い環境でも落ちない');
{
  let ok = true, err = '';
  try {
    const ctx = { $response: { body: HTML(), headers: { 'content-type': 'text/html' } }, $done: () => {}, console };
    vm.createContext(ctx);
    vm.runInContext(src, ctx, { timeout: 5000 });
  } catch (e) { ok = false; err = e.message; }
  check('$request 未定義で例外を投げない', ok, err);
}

console.log('---------------------------------------------');
console.log(`pass=${pass} fail=${fail}`);
if (failures.length) { console.log('FAILURES:'); failures.forEach(f => console.log(' - ' + f)); process.exitCode = 1; }
