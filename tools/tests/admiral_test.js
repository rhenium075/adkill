/*
 * admiral_test.js — Admiral 系アンチアドブロック壁 (newsdig で実測) への防御テスト
 *  [1] 対策なし: 壁 iframe + CSS 全滅 + 3秒 confirm が発動することを確認 (脅威の再現)
 *  [2] adkill.js 注入後: ゲートフラグ (as_ + hashCode) で復旧処理ごと不発化することを確認
 *  [3] 生成済みの壁 iframe を sweep が除去し、通常の埋め込み iframe は残すことを確認
 * fixtures/admiral_recovery_sim.js は実測仕様のクリーンルーム再現。ネットワークは全てスタブ。
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ADKILL = path.join(__dirname, '..', '..', 'adkill.js');
const simSrc = fs.readFileSync(path.join(__dirname, 'fixtures', 'admiral_recovery_sim.js'), 'utf8');

function extractInjectedJS(url) {
  let out = null;
  const ctx = {
    $request: { url },
    $response: { body: '<html><head></head><body></body></html>', headers: { 'content-type': 'text/html' } },
    $done: (r) => { out = r; },
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(ADKILL, 'utf8'), ctx);
  const m = out.body.match(/<script id="__adkill_js">([\s\S]*?)<\/script>/);
  return m ? m[1] : null;
}
const INJECTED = extractInjectedJS('https://newsdig.tbs.co.jp/');

let pass = 0, fail = 0; const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

function makeDom() {
  const vcon = new VirtualConsole();
  vcon.on('jsdomError', () => {});
  const dom = new JSDOM(`<!DOCTYPE html><html><head><title>t</title>
      <style id="site-css">body{color:#000}</style>
    </head><body><main id="content"><p>記事本文</p></main></body></html>`, {
    url: 'https://newsdig.tbs.co.jp/',
    runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vcon,
  });
  const w = dom.window;
  const calls = { confirm: 0, fetches: [] };
  w.fetch = (u) => { calls.fetches.push(String(u)); return Promise.resolve({ text: () => Promise.resolve('EV-TEST') }); };
  w.confirm = () => { calls.confirm++; return false; };
  try { Object.defineProperty(w.location, 'reload', { value: () => {}, configurable: true }); } catch (e) {}
  Object.defineProperty(w, 'innerWidth', { value: 390, configurable: true });
  Object.defineProperty(w, 'innerHeight', { value: 844, configurable: true });
  w.Element.prototype.getBoundingClientRect = function () {
    const st = (this.getAttribute && this.getAttribute('style')) || '';
    if (/100vw/.test(st)) return { width: 390, height: 844, top: 0, left: 0, right: 390, bottom: 844 };
    return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
  };
  // jsdom は inline style の position/z-index を返すが、Proxy で確実化
  const origGCS = w.getComputedStyle.bind(w);
  w.getComputedStyle = (el, ps) => {
    const cs = origGCS(el, ps);
    const st = (el.getAttribute && el.getAttribute('style')) || '';
    if (/position:\s*fixed/.test(st)) {
      return new Proxy(cs, { get: (t, k) => k === 'position' ? 'fixed' : (k === 'zIndex' ? ((st.match(/z-index:\s*(\d+)/) || [])[1] || t[k]) : t[k]) });
    }
    return cs;
  };
  if (!('innerText' in w.HTMLElement.prototype)) {
    Object.defineProperty(w.HTMLElement.prototype, 'innerText', { get() { return this.textContent; }, configurable: true });
  }
  return { w, calls };
}

(async () => {
  console.log('[1] 対策なし: 壁が発動する (脅威の再現)');
  {
    const { w, calls } = makeDom();
    w.eval(simSrc);
    await new Promise(r => setTimeout(r, 3500));
    check('壁 iframe が生成される', [...w.document.querySelectorAll('iframe')].some(f => /error-report/.test(f.src || '')));
    check('link/style が全滅する', !w.document.getElementById('site-css'));
    check('3秒後に confirm が発動する', calls.confirm >= 1);
  }

  console.log('[2] adkill.js 注入後: ゲートフラグで不発化');
  {
    const { w, calls } = makeDom();
    w.eval(INJECTED);
    w.eval(simSrc);
    await new Promise(r => setTimeout(r, 3500));
    check('壁 iframe が生成されない', ![...w.document.querySelectorAll('iframe')].some(f => /error-report/.test(f.src || '')));
    check('style が保護される', !!w.document.getElementById('site-css'));
    check('confirm が発動しない', calls.confirm === 0);
    check('error-report.com への POST が発生しない', !calls.fetches.some(u => /error-report/.test(u)));
  }

  console.log('[3] 生成済み壁 iframe の sweep 除去 (保険経路)');
  {
    const { w } = makeDom();
    const wall = w.document.createElement('iframe');
    wall.src = 'https://report.error-report.com/modal?eventId=EV&error=x';
    wall.setAttribute('style', 'width: 100vw; height: 100vh; z-index: 2147483647; position: fixed; left: 0; top: 0;');
    w.document.documentElement.appendChild(wall);
    const yt = w.document.createElement('iframe');
    yt.src = 'https://www.youtube.com/embed/xxxx';
    yt.setAttribute('style', 'width: 100%; height: 300px;');
    w.document.body.appendChild(yt);
    w.eval(INJECTED);
    w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
    await new Promise(r => setTimeout(r, 800));
    check('壁 iframe が除去される', ![...w.document.querySelectorAll('iframe')].some(f => /error-report/.test(f.src || '')));
    check('通常の埋め込み iframe は残る', [...w.document.querySelectorAll('iframe')].some(f => /youtube/.test(f.src || '')));
  }

  console.log('---------------------------------------------');
  console.log(`pass=${pass} fail=${fail}`);
  if (failures.length) { console.log('FAILURES:'); failures.forEach(f => console.log(' - ' + f)); }
  process.exit(fail ? 1 : 0);
})();
