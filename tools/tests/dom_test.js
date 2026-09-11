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
    check('汎用 dialog は文言と寸法だけでは削除しない', !!w.document.getElementById('wall'));
    check('本文は残る', !!w.document.getElementById('content'));
    check('未確定の dialog のスクロールロックを保つ', w.document.body.style.getPropertyValue('overflow') === 'hidden');
    check('未確定の dialog のクラスを保つ', w.document.body.classList.contains('modal-open'));
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

console.log('[8] R03: 文書ルート・本文ラッパーを削除しない');
{
  const longText = '通常の記事本文です。'.repeat(60); // 400字超の本文
  const dom = makeDom(`<html><head></head><body class="adblock-disabled">
    <div id="wrapper" class="adblock-detected-wrapper"><main id="content"><p>${longText}</p></main></div>
    <div id="notice" class="adblock-notice">広告ブロッカーをご利用ですね</div>
  </body></html>`);
  const w = dom.window;
  runInjected(dom);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  global.__pending.push(async () => {
    await new Promise(r => setTimeout(r, 800));
    check('R03: 状態クラス付き body は削除されない', !!w.document.body && w.document.body.classList.contains('adblock-disabled'));
    check('R03: 長い本文を包む adblock 名ラッパーは削除されない', !!w.document.getElementById('wrapper'));
    check('R03: 本文は無傷', !!w.document.getElementById('content'));
    check('短い adblock 通知は除去される', !w.document.getElementById('notice'));
  });
}

console.log('[8.5] R03 残件 (再レビュー): 短い本文・描画前ラッパーを削除しない');
{
  const dom = makeDom(`<html><head></head><body>
    <div class="adblock-disabled" id="shortwrap"><main id="shortart"><h1>News</h1><p>A short article.</p></main></div>
    <div class="adblock-detected" id="prerender"></div>
    <div class="adblock-notice" id="realnotice">広告ブロッカーを無効にしてください。続きを読むには広告を許可してください。</div>
  </body></html>`);
  const w = dom.window;
  runInjected(dom);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  global.__pending.push(async () => {
    await new Promise(r => setTimeout(r, 800));
    check('短い本文 (<400字) を包む byName ラッパーは削除されない (main 内包)', !!w.document.getElementById('shortwrap'));
    check('短い本文の main は無傷', !!w.document.getElementById('shortart'));
    check('描画前で中身が空の byName ラッパーは削除されない (byText 不成立)', !!w.document.getElementById('prerender'));
    check('名前と文言が両方一致する通知は除去される', !w.document.getElementById('realnotice'));
  });
}

console.log('[9] R04: 壁除去後の正当なモーダルのロックを壊さない');
{
  const dom = makeDom(`<html><head></head><body>
    <main id="content"><p>本文</p></main>
    <div id="wall" class="adblock-overlay" style="position:fixed" data-rect-w="390" data-rect-h="844"><p>広告ブロッカーを無効にしてください</p></div>
  </body></html>`);
  const w = dom.window;
  runInjected(dom);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  global.__pending.push(async () => {
    await new Promise(r => setTimeout(r, 800));
    check('R04 前提: 壁は除去済み', !w.document.getElementById('wall'));
    // 壁除去後、サイトが正当なログインモーダルを開きスクロールをロックする
    w.eval(`
      var m = document.createElement('div'); m.id = 'login-modal';
      m.setAttribute('role','dialog');
      m.innerHTML = '<form><input><button>ログイン<\\/button></form>';
      document.body.appendChild(m);
      document.body.classList.add('modal-open');
      document.body.style.overflow = 'hidden';
    `);
    await new Promise(r => setTimeout(r, 1400)); // 以後の sweep を複数回またぐ
    check('R04: 正当なモーダルは残る', !!w.document.getElementById('login-modal'));
    check('R04: body の overflow:hidden が維持される', w.document.body.style.overflow === 'hidden',
      `overflow="${w.document.body.style.overflow}"`);
    check('R04: modal-open クラスが維持される', w.document.body.classList.contains('modal-open'));
  });
}

console.log('[10] URL 境界・通常フォーム・タイマーを保護する');
{
  const dom = makeDom(`<html><head></head><body>
    <iframe id="query" src="https://video.example/embed?help=error-report.com"></iframe>
    <iframe id="suffix" src="https://error-report.com.other.example/modal"></iframe>
    <iframe id="otherpath" src="https://report.error-report.com/help"></iframe>
    <iframe id="large" src="https://video.example/embed" style="position:fixed;z-index:2147483647" data-rect-w="390" data-rect-h="844"></iframe>
    <div class="adblock-settings" id="settings" style="position:fixed"><form>広告ブロックの表示設定<input><button>保存</button></form></div>
  </body></html>`);
  const w = dom.window;
  const originalTimeout = w.setTimeout;
  runInjected(dom);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  for (const id of ['query', 'suffix', 'otherpath', 'large', 'settings']) check(`正常な要素を保護: ${id}`, !!w.document.getElementById(id));
  check('setTimeout の関数自体を置き換えない', w.setTimeout === originalTimeout);
  w.eval('setTimeout(function(){window.__helpText="adblock detection"}, 0)');
  global.__pending.push(async () => {
    await new Promise(r => setTimeout(r, 50));
    check('検知文字列を含む正常なコールバックが実行される', w.__helpText === 'adblock detection');
  });
}

console.log('[11] フォーム自身・編集領域・壁候補名の本文を保護する');
{
  const dom = makeDom(`<html><head></head><body>
    <form id="self-form" class="adblock-settings">広告ブロックの設定</form>
    <div id="editor" class="adblock-settings" contenteditable>広告ブロックの設定</div>
    <button id="self-button" class="adblock-settings">広告ブロックの設定</button>
    <article id="anti-article" class="anti-adb-guide">広告ブロックの解説</article>
    <div id="anti-wall" class="anti-adb-notice">広告ブロッカーを無効にしてください</div>
  </body></html>`);
  const w = dom.window;
  runInjected(dom);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  for (const id of ['self-form', 'editor', 'self-button', 'anti-article']) check(`要素自身を保護: ${id}`, !!w.document.getElementById(id));
  check('確認済みの anti-adb 通知は除去する', !w.document.getElementById('anti-wall'));
  // An empty form can acquire controls after the first sweep.
  const input = w.document.createElement('input');
  w.document.getElementById('self-form').appendChild(input);
  check('動的フォームへ入力部品を追加できる', input.isConnected);
  dom.window.close();
}

// ---------------------------------------------------------------
(async () => {
  for (const f of (global.__pending || [])) await f();
  console.log('---------------------------------------------');
  console.log(`pass=${pass} fail=${fail}`);
  if (failures.length) { console.log('FAILURES:'); failures.forEach(f => console.log(' - ' + f)); process.exitCode = 1; }
  process.exit(process.exitCode || 0);
})();
