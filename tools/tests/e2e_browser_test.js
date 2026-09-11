/*
 * e2e_browser_test.js — 実ブラウザエンジン (Playwright + Chromium) での E2E 検証
 *
 * jsdom はレイアウトを持たないため検証できない項目を、拡張機能なしのクリーンな
 * Chromium で検証する:
 *  - bait 要素 (FuckAdBlock/IAB) が実レイアウトで可視のまま (=検知されない)
 *  - 実物 FuckAdBlock / IAB AdBlockDetection ライブラリの abort-on-read 無力化
 *  - 広告枠 CSS が実エンジンで効く / Ad-Shield 復元広告の visibility 隠し
 *  - Ad-Shield 復旧スクリプト (観測仕様の再実装) の壁: 対策なし=発動 / adkill=不発
 *  - 壁 iframe / 日本語壁オーバーレイの sweep とスクロール復帰
 *
 * 依存: npm i -D playwright && npx playwright install chromium (任意導入)
 * ネットワークは page.route で全遮断。実物ライブラリは初回のみ .cache へ取得。
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  // --required / E2E_REQUIRED=1 のときはスキップを失敗扱いにする (レビュー: 対象外経路を成功扱いしない)
  console.log('SKIP: playwright 未導入 (npm i -D playwright && npx playwright install chromium)');
  process.exit((process.env.E2E_REQUIRED || process.argv.includes('--required')) ? 1 : 0);
}

const ROOT = path.join(__dirname, '..', '..');
const CACHE = path.join(__dirname, '.cache');
// 外部ライブラリはコミット固定 (レビュー: ブランチ先端取得だと検証環境が変わり得るため)
const LIBS = {
  'fuckadblock.js': 'https://raw.githubusercontent.com/sitexw/FuckAdBlock/41af4faebc219b44f84c682b24b57ad1e413b3cb/fuckadblock.js',
  'iab_detector.js': 'https://raw.githubusercontent.com/InteractiveAdvertisingBureau/AdBlockDetection/e001ef8754082dd07341064e16fa50e5c7985603/adblockDetector.js',
};

async function ensureLibs() {
  fs.mkdirSync(CACHE, { recursive: true });
  for (const [name, url] of Object.entries(LIBS)) {
    const p = path.join(CACHE, name);
    if (fs.existsSync(p) && fs.statSync(p).size > 1000) continue;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
    fs.writeFileSync(p, await res.text());
  }
}

function extractInjected(url) {
  let out = null;
  const ctx = {
    $request: { url },
    $response: { body: '<html><head></head><body></body></html>', headers: { 'content-type': 'text/html' } },
    $done: (r) => { out = r; },
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'adkill.js'), 'utf8'), ctx);
  const css = out.body.match(/<style id="__adkill_css">[\s\S]*?<\/style>/)[0];
  const js = out.body.match(/<script id="__adkill_js">[\s\S]*?<\/script>/)[0];
  return css + js;
}

let pass = 0, fail = 0; const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

function buildPage({ withAdkill }) {
  const payload = withAdkill ? extractInjected('https://newsdig.tbs.co.jp/') : '';
  const simSrc = fs.readFileSync(path.join(__dirname, 'fixtures', 'adshield_recovery_sim.js'), 'utf8');
  return `<!DOCTYPE html><html><head><title>adkill e2e</title>
  <style id="site-css">body{color:#111;position:relative}main{min-height:200px}</style>
  ${payload}
</head><body>
  <main id="content"><p>本文コンテンツ</p></main>

  <!-- bait 要素 (FuckAdBlock 系 + IAB 系 + 汎用おとり) -->
  <div id="bait1" class="pub_300x250 pub_300x250m pub_728x90 text-ad textAd text_ad text_ads text-ads text-ad-links">&nbsp;</div>
  <div id="bait2" class="adsbox">&nbsp;</div>
  <div id="bait3" class="ad ads">&nbsp;</div>
  <!-- "ad-block"/"adblock" を部分文字列として含むだけの無関係クラス (誤爆してはいけない) -->
  <div id="fp1" class="head-block">site header block</div>
  <div id="fp2" class="thread-block">thread content</div>
  <div id="fp3" class="downloadblock">Download attachment</div>

  <article id="anti-article" class="anti-adb-guide">広告ブロックの解説</article>
  <form id="self-form" class="adblock-settings">広告ブロックの設定</form>
  <div id="editor" class="adblock-settings" contenteditable>広告ブロックの設定</div>
  <div id="protected-consent" class="fc-message-root"><form>広告ブロックの設定<input></form></div>
  <div id="abp-guide" class="abp-notice-guide"><article>広告ブロックの解説</article></div>

  <!-- 空広告枠の折り畳み対象 (load+2秒後に畳まれるべき) -->
  <ins id="emptyslot" class="adsbygoogle" style="display:block;min-height:250px"></ins>
  <div id="adwrap" style="min-height:250px"><div id="div-gpt-ad-99999-0"></div></div>
  <!-- 広告と無関係の空きスペース (畳まれてはいけない) -->
  <div id="hero-spacer" style="min-height:120px"></div>
  <!-- 広告枠と canvas グラフが同居するラッパー (再レビュー: canvas を消してはいけない) -->
  <div id="chartwrap" style="min-height:250px">
    <canvas id="chart" width="400" height="200"></canvas>
    <div id="div-gpt-ad-77777-0"></div>
  </div>
  <script>
    (function(){ var c = document.getElementById('chart').getContext('2d');
      c.fillStyle = '#3a7'; c.fillRect(0, 0, 400, 200); })();
  </script>

  <!-- 広告枠 (隠されるべき) -->
  <div id="div-gpt-ad-123456-0" style="width:300px;height:250px">gpt slot</div>
  <!-- Ad-Shield 復元広告の痕跡 (隠されるべき) -->
  <iframe id="asrestored" height="   250" width="   300" style="border:0"></iframe>

  <!-- 通常の埋め込み (残るべき) -->
  <iframe id="normalembed" src="https://adkill-e2e.test/embed.html" style="width:300px;height:150px"></iframe>

  <script>
    window.__R = { fabDetected:false, iabFound:null, dialogs:0, errors:[] };
    window.addEventListener('error', function(e){ window.__R.errors.push(String(e.message).slice(0,120)) });
  </script>

  <!-- 実物 FuckAdBlock (サイト自己ホスト相当) -->
  <script src="https://adkill-e2e.test/fuckadblock.js"></script>
  <script>
    /* 典型的な導入コード */
    try {
      function adBlockDetected(){ window.__R.fabDetected = true; }
      if (typeof fuckAdBlock === 'undefined') { adBlockDetected(); }
      else { fuckAdBlock.onDetected(adBlockDetected); fuckAdBlock.check(true); }
    } catch (e) { window.__R.fabAbort = String(e).slice(0,80); }
  </script>

  <!-- 実物 IAB AdBlockDetection -->
  <script src="https://adkill-e2e.test/iab_detector.js"></script>
  <script>
    try {
      window.adblockDetector.init({
        debug: false, found: function(){ window.__R.iabFound = true; },
        notfound: function(){ window.__R.iabFound = false; }
      });
    } catch (e) { window.__R.iabAbort = String(e).slice(0,80); }
  </script>

  <!-- googletag 事前キュー -->
  <script>
    window.googletag = window.googletag || { cmd: [] };
    window.__R.gptRan = false;
    googletag.cmd.push(function(){
      var s = googletag.defineSlot('/1/x', [300,250], 'div-gpt-ad-123456-0');
      s.addService(googletag.pubads()); googletag.enableServices(); googletag.display('div-gpt-ad-123456-0');
      window.__R.gptRan = true;
    });
  </script>

  <!-- Ad-Shield 復旧スクリプト (観測仕様の再実装) -->
  <script>${simSrc}</script>

  <!-- 日本語アンチアドブロック壁 + 壁 iframe (sweep が除去すべき) -->
  <script>
    setTimeout(function(){
      var d = document.createElement('div');
      d.id = 'jpwall'; d.className = 'adblock-notice'; d.setAttribute('role','dialog');
      d.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;background:#fff;z-index:99999';
      d.innerHTML = '<p>広告ブロッカーを無効にしてください。閲覧を続けるには広告を許可してください。</p>';
      document.body.appendChild(d);
      document.body.classList.add('modal-open');
      document.body.style.overflow = 'hidden';
      var f = document.createElement('iframe');
      f.id = 'wallframe';
      f.src = 'https://report.error-report.com/modal?eventId=EV';
      f.setAttribute('style','width: 100vw; height: 100vh; z-index: 2147483647; position: fixed; left: 0; top: 0;');
      document.documentElement.appendChild(f);
    }, 300);
  </script>

  <!-- setTimeout ガードの誤爆チェック -->
  <script>
    window.__R.legitRan = false;
    setTimeout(function(){ if (window.canRunAds || !window.canRunAds) { window.__R.legitRan = true; } }, 100);
  </script>
</body></html>`;
}

async function run(browser, { withAdkill }) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let dialogs = 0;
  page.on('dialog', async (d) => { dialogs++; await d.dismiss().catch(() => {}); });
  const html = buildPage({ withAdkill });
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url === 'https://adkill-e2e.test/') {
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
    }
    if (url.endsWith('/fuckadblock.js') || url.endsWith('/iab_detector.js')) {
      const name = url.split('/').pop();
      return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(CACHE, name), 'utf8') });
    }
    if (url.endsWith('/embed.html')) {
      return route.fulfill({ contentType: 'text/html', body: '<p>embed</p>' });
    }
    return route.abort(); // 外部通信は全遮断 (error-report.com 等)
  });
  await page.goto('https://adkill-e2e.test/', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(withAdkill ? 4200 : 2500);
  const state = await page.evaluate(() => {
    const vis = (el) => !!el && el.offsetHeight > 0 && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    const R = window.__R || {};
    return {
      R,
      bait1Visible: vis(document.getElementById('bait1')),
      bait2Visible: vis(document.getElementById('bait2')),
      bait3Visible: vis(document.getElementById('bait3')),
      fp1Visible: vis(document.getElementById('fp1')),
      fp2Visible: vis(document.getElementById('fp2')),
      fp3Visible: vis(document.getElementById('fp3')),
      protectedVisible: ['anti-article', 'self-form', 'editor', 'protected-consent', 'abp-guide'].every(id => vis(document.getElementById(id))),
      emptySlotCollapsed: (() => { const el = document.getElementById('emptyslot'); return !!el && el.offsetHeight === 0; })(),
      adwrapCollapsed: (() => { const el = document.getElementById('adwrap'); return !!el && el.offsetHeight === 0; })(),
      heroSpacerKept: (() => { const el = document.getElementById('hero-spacer'); return !!el && el.offsetHeight >= 100; })(),
      chartVisible: (() => { const el = document.getElementById('chart'); return !!el && el.offsetHeight >= 150 && getComputedStyle(document.getElementById('chartwrap')).display !== 'none'; })(),
      gptHidden: !vis(document.getElementById('div-gpt-ad-123456-0')),
      asRestoredHidden: (() => { const el = document.getElementById('asrestored'); return !!el && getComputedStyle(el).visibility === 'hidden'; })(),
      normalEmbed: !!document.getElementById('normalembed'),
      jpwall: !!document.getElementById('jpwall'),
      wallframe: !!document.getElementById('wallframe'),
      adshieldWall: [...document.querySelectorAll('iframe')].some(f => /error-report\.com\/modal/.test(f.src || '') && f.id !== 'wallframe'),
      siteCss: !!document.getElementById('site-css'),
      bodyOverflow: document.body.style.overflow,
      typeofFab: (() => { try { return typeof window.fuckAdBlock; } catch (e) { return 'THROWS'; } })(),
    };
  }).catch((e) => ({ evalError: String(e) }));
  await page.close();
  return { state, dialogs };
}

(async () => {
  await ensureLibs();
  // PLAYWRIGHT_CHROMIUM_PATH でローカル既存ビルドを指定可能 (CDN 不達時の回避)
  const exe = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});

  console.log('[A] コントロール (adkill なし): 攻撃側が実際に機能する環境かの確認');
  {
    const { state } = await run(browser, { withAdkill: false });
    check('Ad-Shield sim の壁 iframe が発動する', state.adshieldWall);
    check('site CSS が全滅させられる', !state.siteCss);
    check('FuckAdBlock/IAB が正常動作する (検知 or 未検知のどちらかに到達)',
      state.R.fabDetected === true || state.R.iabFound !== null || state.typeofFab === 'object');
  }

  console.log('[B] adkill あり: 全対策の実エンジン検証');
  {
    const { state, dialogs } = await run(browser, { withAdkill: true });
    check('bait (pub_300x250 等) は可視のまま', state.bait1Visible, JSON.stringify(state));
    check('bait (adsbox) は可視のまま', state.bait2Visible);
    check('bait (.ad .ads) は可視のまま', state.bait3Visible);
    check('class="head-block" は誤爆しない (可視のまま)', state.fp1Visible);
    check('class="thread-block" は誤爆しない (可視のまま)', state.fp2Visible);
    check('class="downloadblock" は誤爆しない (R03: "adblock" 部分一致 CSS の撤去)', state.fp3Visible);
    check('CSS と JS の両方で本文・フォーム・編集領域を可視のまま保護', state.protectedVisible);
    check('空の ins.adsbygoogle が折り畳まれる (空白対策)', state.emptySlotCollapsed);
    check('gpt 枠だけの親ラッパーが折り畳まれる (空白対策)', state.adwrapCollapsed);
    check('広告と無関係の空きスペースは畳まれない', state.heroSpacerKept);
    check('広告枠と同居する canvas グラフは畳まれない (再レビュー)', state.chartVisible);
    check('FuckAdBlock は検知に至らない', state.R.fabDetected === false);
    check('FuckAdBlock へのアクセスは abort する', state.typeofFab === 'THROWS');
    check('IAB detector は found に至らない', state.R.iabFound !== true);
    check('googletag 事前キューが完走する', state.R.gptRan === true);
    check('gpt 広告枠は隠される', state.gptHidden);
    check('Ad-Shield 復元広告 (スペース詰め属性) は隠される', state.asRestoredHidden);
    check('通常の埋め込み iframe は残る', state.normalEmbed);
    check('Ad-Shield 復旧壁が不発 (ゲートフラグ)', !state.adshieldWall);
    check('site CSS が保護される', state.siteCss);
    check('confirm ダイアログが出ない', dialogs === 0, `dialogs=${dialogs}`);
    check('日本語壁オーバーレイが除去される', !state.jpwall);
    check('壁 iframe が除去される', !state.wallframe);
    check('スクロールロックが解除される', state.bodyOverflow === 'auto', `overflow=${state.bodyOverflow}`);
    check('正当な setTimeout コールバックは実行される', state.R.legitRan === true);
  }

  await browser.close();
  console.log('---------------------------------------------');
  console.log(`pass=${pass} fail=${fail}`);
  if (failures.length) { console.log('FAILURES:'); failures.forEach(f => console.log(' - ' + f)); }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
