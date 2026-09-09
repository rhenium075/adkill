/*
 * dom_test.js — 注入後ページの疑似 DOM 環境テスト (jsdom)
 * adkill.js が生成する注入ペイロードを実ページ相当の DOM で実行し、
 * スタブ・検知 abort・オーバーレイ掃除・スクロール復帰を検証する。
 * jsdom はレイアウトを持たないため getBoundingClientRect / innerWidth /
 * getComputedStyle(position) をパッチして「全画面 fixed オーバーレイ」を再現する。
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { JSDOM } = require('jsdom');

const SCRIPT_PATH = process.argv[2] || path.join(__dirname, '..', '..', 'adkill.js');
const src = fs.readFileSync(SCRIPT_PATH, 'utf8');

// adkill.js を通して注入ペイロード(JSのみ)を取り出す
function extractInjectedJS() {
  let out = null;
  const ctx = {
    $request: { url: 'https://test.example.com/' },
    $response: { body: '<html><head></head><body></body></html>', headers: { 'content-type': 'text/html' } },
    $done: (r) => { out = r; },
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const m = out.body.match(/<script id="__adkill_js">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('injected JS not found');
  return m[1];
}
const INJECTED = extractInjectedJS();

let pass = 0, fail = 0; const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

function makeDom(html, url) {
  const dom = new JSDOM(html, { url: url || 'https://site.example.com/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  // レイアウトの疑似化
  Object.defineProperty(w, 'innerWidth', { value: 390, configurable: true });
  Object.defineProperty(w, 'innerHeight', { value: 844, configurable: true });
  w.Element.prototype.getBoundingClientRect = function () {
    const rw = this.getAttribute && this.getAttribute('data-rect-w');
    if (rw) return { width: +rw, height: +(this.getAttribute('data-rect-h') || 0), top: 0, left: 0, right: 0, bottom: 0 };
    return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
  };
  // jsdom は innerText 未実装 → textContent で代用
  if (!('innerText' in w.HTMLElement.prototype)) {
    Object.defineProperty(w.HTMLElement.prototype, 'innerText', {
      get() { return this.textContent; },
      configurable: true,
    });
  }
  // jsdom の getComputedStyle は inline style を反映するのでそのまま使える
  return dom;
}

function runInjected(dom) {
  dom.window.eval(INJECTED);
}

// ---------------------------------------------------------------
console.log('[1] adsbygoogle スタブ');
{
  const dom = makeDom('<html><head></head><body></body></html>');
  const w = dom.window;
  // ページが先に push している(実際のサイト挙動)
  w.eval('window.adsbygoogle = window.adsbygoogle || []; window.adsbygoogle.push({a:1});');
  runInjected(dom);
  check('adsbygoogle.loaded === true', w.eval('window.adsbygoogle.loaded === true'));
  check('push しても例外が出ない', (() => { try { w.eval('(window.adsbygoogle=window.adsbygoogle||[]).push({})'); return true; } catch (e) { return false; } })());
  check('adsbygoogle への再代入が無害化される', w.eval('window.adsbygoogle = "broken"; window.adsbygoogle.loaded === true'));
  check('data-adkill 属性が付く', w.document.documentElement.getAttribute('data-adkill') === 'on');
}

console.log('[2] googletag スタブと cmd キューの後処理');
{
  const dom = makeDom('<html><head></head><body></body></html>');
  const w = dom.window;
  // 注入前にサイトが googletag.cmd にコールバックを積んでいる (よくあるパターン)
  w.eval(`
    window.googletag = window.googletag || { cmd: [] };
    window.__cmdRan = false; window.__cmdError = null;
    window.googletag.cmd.push(function(){
      try {
        var slot = googletag.defineSlot('/123/top', [300,250], 'div-1');
        slot.addService(googletag.pubads());
        googletag.enableServices();
        googletag.display('div-1');
        window.__cmdRan = true;
      } catch(e) { window.__cmdError = String(e); }
    });
  `);
  runInjected(dom);
  check('googletag.apiReady === true', w.eval('window.googletag.apiReady === true'));
  check('事前キューのコールバックがスタブで正常完走する', w.eval('window.__cmdRan === true'),
    'error=' + w.eval('window.__cmdError'));
  check('注入後の cmd.push は即時実行される', w.eval('var x=0; googletag.cmd.push(function(){x=1}); x===1'));
  check('pubads() チェーンが破綻しない', w.eval('googletag.pubads().setTargeting("a","b").refresh(); true'));
}

console.log('[3] 検知ライブラリの abort-on-read');
{
  const dom = makeDom('<html><head></head><body></body></html>');
  const w = dom.window;
  runInjected(dom);
  check('blockAdBlock 参照で throw', w.eval('var t=false; try{ blockAdBlock }catch(e){ t = e instanceof ReferenceError } t'));
  check('fuckAdBlock 参照で throw', w.eval('var t=false; try{ window.fuckAdBlock }catch(e){ t=true } t'));
  check('canRunAds === true', w.eval('window.canRunAds === true'));
  check('googlefc.getAdBlockerStatus() === NO_AD_BLOCKER', w.eval('window.googlefc.getAdBlockerStatus() === window.googlefc.AdBlockerStatusEnum.NO_AD_BLOCKER'));
}

console.log('[4] setTimeout ガードの副作用 (誤爆チェック)');
{
  const dom = makeDom('<html><head></head><body></body></html>');
  const w = dom.window;
  runInjected(dom);
  // サイトの正当なコード: canRunAds が true なら本文を表示する分岐
  const r = w.eval(`
    window.__contentShown = false;
    var id = setTimeout(function(){
      if (window.canRunAds) { window.__contentShown = true; }
      else { document.body.innerHTML = '<div class="wall">disable adblock</div>'; }
    }, 0);
    id;
  `);
  const shown = new Promise((res) => setTimeout(() => res(w.__contentShown), 50));
  module.exports = { shown };
  // 同期的に待てないので後段でまとめて await する
  global.__pending = global.__pending || [];
  global.__pending.push(async () => {
    const v = await shown;
    check('canRunAds を含む正当なコールバックが実行される', v === true,
      'setTimeout ガードが canRunAds を含む関数を握り潰している (returnした id=' + r + ')');
  });
}

console.log('[5] アンチアドブロック・オーバーレイの掃除');
{
  const dom = makeDom(`<html><head></head><body class="modal-open" style="overflow:hidden">
    <main id="content"><p>記事本文</p></main>
    <div id="wall" role="dialog" style="position:fixed" data-rect-w="390" data-rect-h="844">
      <p>広告ブロッカーを無効にしてください。このサイトは広告収入で運営されています。</p>
    </div>
  </body></html>`);
  const w = dom.window;
  runInjected(dom);
  // sweep は DOMContentLoaded/interval 起点。jsdom では手動で発火させる
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  global.__pending.push(async () => {
    await new Promise(r => setTimeout(r, 800)); // interval sweep 1回分待つ
    check('壁 (role=dialog + 検知文言 + 全画面fixed) が除去される', !w.document.getElementById('wall'));
    check('本文は残る', !!w.document.getElementById('content'));
    check('body の overflow ロックが解除される', w.document.body.style.getPropertyValue('overflow') === 'auto');
    check('modal-open クラスが外れる', !w.document.body.classList.contains('modal-open'));
  });
}

console.log('[6] unlock() の副作用 (position:relative を壊さないか)');
{
  const dom = makeDom(`<html><head></head><body style="position:relative">
    <div class="adblock-notice" style="position:fixed" data-rect-w="390" data-rect-h="844">please disable your ad blocker</div>
  </body></html>`);
  const w = dom.window;
  runInjected(dom);
  global.__pending.push(async () => {
    await new Promise(r => setTimeout(r, 800));
    check('byName の壁が除去される', !w.document.querySelector('.adblock-notice'));
    const pos = w.document.body.style.getPropertyValue('position');
    check('body の position:relative が static に強制されない', pos === 'relative',
      `position が "${pos}" に変更された (absolute配置のレイアウトが壊れる)`);
  });
}

console.log('[7] 正当な要素の誤爆チェック');
{
  const dom = makeDom(`<html><head></head><body>
    <div id="cookie" role="dialog" style="position:fixed" data-rect-w="390" data-rect-h="200"><p>Cookie の利用に同意しますか？</p></div>
    <article id="art"><h1>アドブロック検知の仕組みを解説</h1><p>広告ブロッカーを無効にしてくださいと表示される仕組み…</p></article>
  </body></html>`);
  const w = dom.window;
  runInjected(dom);
  global.__pending.push(async () => {
    await new Promise(r => setTimeout(r, 800));
    check('小さい cookie ダイアログは消えない (big() 判定)', !!w.document.getElementById('cookie'));
    check('検知文言を含む通常記事は消えない (fixed でない)', !!w.document.getElementById('art'));
  });
}

// ---------------------------------------------------------------
(async () => {
  for (const f of (global.__pending || [])) await f();
  console.log('---------------------------------------------');
  console.log(`pass=${pass} fail=${fail}`);
  if (failures.length) { console.log('FAILURES:'); failures.forEach(f => console.log(' - ' + f)); process.exitCode = 1; }
  process.exit(process.exitCode || 0);
})();
