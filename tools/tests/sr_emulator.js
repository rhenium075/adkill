/*
 * sr_emulator.js — Shadowrocket 挙動エミュレータ (Playwright + Chromium)
 *
 * 実サイトを読み込みながら、端末上の Shadowrocket と同じ処理を再現する:
 *  1. conf の [Rule] 順にフルルールセットを評価
 *     (adkill_custom.list → adkill_jp.list → blackmatrix7 Advertising → BanAD → BanProgramAD)
 *  2. マッチしたリクエストは REJECT-TINYGIF (200 + 1x1 GIF) で応答
 *  3. text/html 応答は adkill.js に通して CSS/JS を注入 (MITM 除外ホストは素通し)
 *
 * これにより「どのリソースがどのルールで潰されたか」「注入で何が壊れるか」を
 * 実機なしで特定できる。
 *
 * Usage:
 *   node sr_emulator.js <url> [--no-adkill] [--shot out.png] [--wait ms] [--verbose]
 *     --no-adkill : ブロックも注入もしない素の状態 (比較用ベースライン)
 *     --shot      : スクリーンショット保存先
 *     --wait      : 読み込み後の待機 ms (既定 6000)
 *
 * 依存: playwright (+ .cache/ に上流 RULE-SET。無ければ自動取得)
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { console.error('playwright 未導入: npm i -D playwright && npx playwright install chromium'); process.exit(1); }

const ROOT = path.join(__dirname, '..', '..');
const CACHE = path.join(__dirname, '.cache');
const UPSTREAM = {
  'Advertising.list': 'https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Surge/Advertising/Advertising.list',
  'BanAD.list': 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/BanAD.list',
  'BanProgramAD.list': 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/BanProgramAD.list',
  // --dns 用 (レビュー R07: これが無いと独自ルールのみの検証になるため取得対象に含める)
  'adguard_dns_filter.txt': 'https://adguardteam.github.io/AdGuardSDNSFilter/Filters/filter.txt',
};
const TINYGIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

// ---------- ルールエンジン ----------
function parseRuleFile(file, source) {
  const rules = [];
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('!') || line.startsWith(';') || line.startsWith('//')) continue;
    const parts = line.split(',');
    const type = parts[0].toUpperCase();
    const val = (parts[1] || '').trim().toLowerCase();
    if (!val) continue;
    if (type === 'DOMAIN' || type === 'DOMAIN-SUFFIX' || type === 'DOMAIN-KEYWORD') {
      rules.push({ type, val, source, line });
    } else if (type === 'URL-REGEX') {
      try { rules.push({ type, re: new RegExp(parts.slice(1).join(',')), source, line }); } catch (e) {}
    }
    // IP-CIDR / USER-AGENT / PROCESS-NAME 等はエミュレーション対象外
  }
  return rules;
}

async function ensureUpstream() {
  fs.mkdirSync(CACHE, { recursive: true });
  for (const [name, url] of Object.entries(UPSTREAM)) {
    const p = path.join(CACHE, name);
    if (fs.existsSync(p) && fs.statSync(p).size > 1000) continue;
    process.stderr.write(`fetching ${name}...\n`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    fs.writeFileSync(p, await res.text());
  }
}

function buildMatcher() {
  // conf の [Rule] の RULE-SET 順と同じ
  // 環境変数で過去バージョンに差し替え可能 (端末に古い版が残っている状況の再現用)
  const sources = [
    [process.env.CUSTOM_LIST || path.join(ROOT, 'adkill_custom.list'), 'custom'],
    [path.join(ROOT, 'adkill_jp.list'), 'jp'],
    [path.join(CACHE, 'Advertising.list'), 'blackmatrix7'],
    [path.join(CACHE, 'BanAD.list'), 'BanAD'],
    [path.join(CACHE, 'BanProgramAD.list'), 'BanProgramAD'],
  ];
  const all = [];
  for (const [f, s] of sources) all.push(...parseRuleFile(f, s));
  // 高速化: ドメイン系はインデックス化 (評価順は SR も「どれかにマッチ」で同じ結果)
  const exact = new Map(), suffix = new Map(), keywords = [], regexes = [];
  for (const r of all) {
    if (r.type === 'DOMAIN') { if (!exact.has(r.val)) exact.set(r.val, r); }
    else if (r.type === 'DOMAIN-SUFFIX') { if (!suffix.has(r.val)) suffix.set(r.val, r); }
    else if (r.type === 'DOMAIN-KEYWORD') keywords.push(r);
    else if (r.type === 'URL-REGEX') regexes.push(r);
  }
  return (url) => {
    let host = '';
    try { host = new URL(url).hostname.toLowerCase(); } catch (e) { return null; }
    if (exact.has(host)) return exact.get(host);
    const labels = host.split('.');
    for (let i = 0; i < labels.length - 1; i++) {
      const suf = labels.slice(i).join('.');
      if (suffix.has(suf)) return suffix.get(suf);
    }
    for (const r of keywords) if (host.includes(r.val)) return r;
    for (const r of regexes) if (r.re.test(url)) return r;
    return null;
  };
}

// ---------- DNS 層 (AdGuard DNS) エミュレーション ----------
// SR の dns-server はフィルタ付き AdGuard DoH のため、SR ルールにマッチしない
// 広告ドメインは DNS で NXDOMAIN 相当のハード失敗になる。これを route.abort で再現する。
function buildDnsMatcher() {
  const block = new Set(), except = new Set(), regexes = [], exceptRegexes = [];
  const addLine = (line) => {
    line = line.trim();
    if (!line || line.startsWith('!') || line.startsWith('#')) return;
    let neg = false;
    if (line.startsWith('@@')) { neg = true; line = line.slice(2); }
    let m = line.match(/^\|\|([a-z0-9.-]+)\^(\$.*)?$/i);
    if (m) {
      if (m[2] && !neg) return; // 修飾子付きは保守的にスキップ
      (neg ? except : block).add(m[1].toLowerCase());
      return;
    }
    m = line.match(/^\/(.+)\/$/);
    if (m) { try { (neg ? exceptRegexes : regexes).push(new RegExp(m[1], 'i')); } catch (e) {} }
  };
  // (レビュー R07) 上流フィルタが無い状態で「DNS 検証済み」の顔をしないため、欠落は即エラー
  const upstream = path.join(CACHE, 'adguard_dns_filter.txt');
  if (!fs.existsSync(upstream) || fs.statSync(upstream).size < 10000) {
    throw new Error('--dns には .cache/adguard_dns_filter.txt が必要です (ensureUpstream が取得します)');
  }
  for (const f of [upstream, path.join(ROOT, 'adguard_dns_userrules.txt')]) {
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) addLine(line);
  }
  process.stderr.write(`--dns: 上流フィルタ ${fs.statSync(upstream).size} bytes (取得日時 ${fs.statSync(upstream).mtime.toISOString()}) + userrules\n`);
  const inSet = (set, host) => {
    const labels = host.split('.');
    for (let i = 0; i < labels.length - 1; i++) if (set.has(labels.slice(i).join('.'))) return true;
    return false;
  };
  return (url) => {
    let host = '';
    try { host = new URL(url).hostname.toLowerCase(); } catch (e) { return false; }
    if (inSet(except, host) || exceptRegexes.some((r) => r.test(host))) return false;
    return inSet(block, host) || regexes.some((r) => r.test(host));
  };
}

// ---------- [URL Rewrite] (モジュールから読み込み) ----------
function urlRewrites() {
  const out = [];
  const txt = fs.readFileSync(process.env.MODULE_PATH || path.join(ROOT, 'adkill_mitm.sgmodule'), 'utf8');
  const sec = txt.split(/^\[URL Rewrite\]$/m)[1];
  if (!sec) return out;
  for (const raw of sec.split(/^\[/m)[0].split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    let m = line.match(/^(\S+)\s+(\S+)\s+(302|307|header)$/);
    if (m) { try { out.push({ re: new RegExp(m[1]), to: m[2] }); } catch (e) {} continue; }
    m = line.match(/^(\S+)\s+-\s+reject$/);
    if (m) { try { out.push({ re: new RegExp(m[1]), reject: true }); } catch (e) {} }
  }
  return out;
}

// ---------- [Script] pattern (モジュール優先。実機と同じ URL 制限で注入する) ----------
function scriptPattern() {
  for (const f of [process.env.MODULE_PATH || path.join(ROOT, 'adkill_mitm.sgmodule'), path.join(ROOT, 'adkill.conf')]) {
    const m = fs.readFileSync(f, 'utf8').match(/^adkill = .*?pattern=([^,]+),/m);
    if (m) return new RegExp(m[1]);
  }
  return /^https?:\/\/.+/;
}

// ---------- MITM 許可リスト (conf + module。"-" は除外) ----------
function parseMitm() {
  const pos = [], neg = [];
  for (const f of [path.join(ROOT, 'adkill.conf'), process.env.MODULE_PATH || path.join(ROOT, 'adkill_mitm.sgmodule')]) {
    const txt = fs.readFileSync(f, 'utf8');
    const m = txt.match(/^hostname\s*=\s*(.+)$/mg) || [];
    for (const line of m) {
      for (const item of line.replace(/^hostname\s*=\s*(%APPEND%)?/, '').split(',')) {
        const t = item.trim().toLowerCase();
        if (!t) continue;
        if (t.startsWith('-')) neg.push(t.slice(1));
        else pos.push(t);
      }
    }
  }
  return { pos, neg };
}
function hostMatches(host, pat) {
  if (pat.startsWith('*.')) return host.endsWith(pat.slice(1)) && host !== pat.slice(2);
  if (pat === '*') return true;
  return host === pat;
}
function isMitm(host, mitm) {
  host = host.toLowerCase();
  if (mitm.neg.some((p) => hostMatches(host, p))) return false;
  return mitm.pos.some((p) => hostMatches(host, p));
}

// ---------- adkill.js 注入 ----------
function injectAdkill(body, url, headers) {
  let out = null;
  const ctx = {
    $request: { url },
    $response: { body, headers: { ...headers } },
    $done: (r) => { out = r; },
    console: { log: () => {} },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(process.env.ADKILL_JS || path.join(ROOT, 'adkill.js'), 'utf8'), ctx, { timeout: 10000 });
  if (out && typeof out.body === 'string') return { body: out.body, headers: out.headers || headers };
  return null; // $done({}) = 無変更
}

// ---------- メイン ----------
(async () => {
  const args = process.argv.slice(2);
  const target = args.find((a) => !a.startsWith('--'));
  if (!target) { console.error('usage: node sr_emulator.js <url> [--no-adkill] [--shot out.png] [--wait ms]'); process.exit(1); }
  const noAdkill = args.includes('--no-adkill');
  const verbose = args.includes('--verbose');
  const shot = args.includes('--shot') ? args[args.indexOf('--shot') + 1] : null;
  const waitMs = args.includes('--wait') ? +args[args.indexOf('--wait') + 1] : 6000;

  const noInject = args.includes('--no-inject'); // 文書への注入だけ停止 (リライト/TINYGIF は動く)
  const noMitm = args.includes('--no-mitm');     // MITM 全停止 = ca-p12 消失/未信頼の再現
                                                 // (リライト・TINYGIF 偽装・注入がすべて止まり、
                                                 //  ブロックは接続断のみになる — レビュー R08)
  const useDns = args.includes('--dns');     // DNS 層 (AdGuard DoH フィルタ) も再現
  const useWebkit = args.includes('--webkit'); // iOS 相当の WebKit エンジンで描画

  await ensureUpstream();
  const match = buildMatcher();
  const dnsMatch = useDns ? buildDnsMatcher() : null;
  const mitm = parseMitm();
  const scriptRe = scriptPattern();
  const rewrites = urlRewrites();
  // 実効 MITM 判定: --no-mitm 時は全ホスト復号不可 (R08: リライト/偽装はこれを参照する)
  const canMitm = (host) => !noMitm && isMitm(host, mitm);
  // 処理可否: 平文 HTTP は復号不要のため、MITM 許可リストや CA の状態と無関係に
  // [Script]/[URL Rewrite]/TINYGIF が適用される (2026-09-10 第7報: blog.livedoor.jp の
  // 実機事故で発覚した実機挙動。エミュレータもこれに合わせる)
  const canProcess = (url, host) => url.startsWith('http:') || canMitm(host);

  let browser;
  if (useWebkit) {
    const { webkit } = require('playwright');
    browser = await webkit.launch();
  } else {
    const exe = process.env.PLAYWRIGHT_CHROMIUM_PATH;
    browser = await chromium.launch(exe ? { executablePath: exe } : {});
  }
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    userAgent: process.env.EMU_UA || 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
    ignoreHTTPSErrors: true,
  });

  const logReq = args.includes('--log-requests') ? args[args.indexOf('--log-requests') + 1] : null;
  const allReqs = [];
  if (logReq) page.on('request', (r) => allReqs.push(`${r.resourceType()}\t${r.url()}`));

  const blocked = [];    // {url, type, rule}
  const injected = [];   // html を注入したURL
  const failed = [];     // ネットワーク失敗
  const consoleErrs = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => consoleErrs.push('pageerror: ' + String(e).slice(0, 200)));
  page.on('requestfailed', (r) => { if (!blocked.some(b => b.url === r.url())) failed.push(`${r.url().slice(0, 120)} (${(r.failure() || {}).errorText})`); });
  page.on('dialog', async (d) => { consoleErrs.push('DIALOG: ' + d.message().slice(0, 100)); await d.dismiss().catch(() => {}); });

  if (!noAdkill) {
    await page.route('**/*', async (route) => {
      const req = route.request();
      const url = req.url();
      const host = (() => { try { return new URL(url).hostname; } catch (e) { return ''; } })();
      // [URL Rewrite] はルールより先に評価するが、HTTPS の URL を読めるのは実効 MITM が
      // 成立しているホストだけ (レビュー R08: MITM なしのリライトを成功扱いしない)。
      // Playwright の route.fulfill は 302 を許可しないため、リライト先の内容を
      // 直接返す (機能挙動としては実機の 302 → 取得に相当するが、302 先の CDN 到達性・
      // CSP/CORS・キャッシュ・古い配信内容の差異は検証できない)。スタブはローカルファイルで応答
      const rw = canProcess(url, host) ? rewrites.find((r) => r.re.test(url)) : null;
      if (rw && rw.reject) {
        blocked.push({ url: url.slice(0, 140), type: req.resourceType(), rule: 'URL Rewrite → REJECT' });
        return route.abort('failed');
      }
      const isStubUrl = url.startsWith('https://cdn.jsdelivr.net/gh/rhenium075/adkill@main/adshield_stub.js');
      if ((rw && rw.to && rw.to.includes('adshield_stub.js')) || isStubUrl) {
        if (rw) blocked.push({ url: url.slice(0, 140), type: req.resourceType(), rule: `URL Rewrite → ${rw.to.slice(0, 80)}` });
        return route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: fs.readFileSync(path.join(ROOT, 'adshield_stub.js'), 'utf8') });
      }
      const hit = match(url);
      if (hit) {
        // MITM 対象なら 200 + GIF の偽装、対象外の HTTPS は SR は応答を作れず接続を閉じる
        if (canProcess(url, host)) {
          blocked.push({ url: url.slice(0, 140), type: req.resourceType(), rule: `${hit.source}: ${hit.line.slice(0, 90)}` });
          return route.fulfill({ status: 200, contentType: 'image/gif', body: TINYGIF });
        }
        blocked.push({ url: url.slice(0, 140), type: req.resourceType(), rule: `${hit.source} (非MITM=接続断): ${hit.line.slice(0, 70)}` });
        return route.abort('connectionfailed');
      }
      if (dnsMatch && dnsMatch(url)) {
        blocked.push({ url: url.slice(0, 140), type: req.resourceType(), rule: 'DNS層(AdGuard DoH): ハード失敗' });
        return route.abort('namenotresolved');
      }
      const isDoc = req.resourceType() === 'document';
      if (isDoc) {
        try {
          const res = await route.fetch();
          const ct = (res.headers()['content-type'] || '').toLowerCase();
          if (ct.includes('text/html') && !noInject && scriptRe.test(url) && canProcess(url, host)) {
            const body = await res.text();
            const r = injectAdkill(body, url, res.headers());
            if (r) {
              injected.push(url.slice(0, 120));
              return route.fulfill({ status: res.status(), headers: r.headers, contentType: ct, body: r.body });
            }
          }
          return route.fulfill({ response: res });
        } catch (e) {
          return route.continue();
        }
      }
      return route.continue();
    });
  }

  const t0 = Date.now();
  let navError = null;
  try {
    await page.goto(target, { waitUntil: 'load', timeout: 45000 });
  } catch (e) { navError = String(e).split('\n')[0]; }
  await page.waitForTimeout(Math.min(waitMs, 3000));
  // 遅延読み込みの広告/検知を発火させるためにスクロール
  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel(0, 1200).catch(() => {});
    await page.waitForTimeout(400);
  }
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await page.waitForTimeout(Math.max(waitMs - 3000, 1000));

  const metrics = await page.evaluate(() => {
    const vis = [...document.querySelectorAll('body *')].filter((el) => {
      const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0;
    }).length;
    const overflowX = document.documentElement.scrollWidth > window.innerWidth + 2;
    return {
      title: document.title,
      textLen: (document.body && document.body.innerText || '').length,
      visibleEls: vis,
      docHeight: document.documentElement.scrollHeight,
      overflowX,
      stylesheets: [...document.styleSheets].length,
      brokenSheets: [...document.querySelectorAll('link[rel=stylesheet]')].filter((l) => { try { return !l.sheet; } catch (e) { return true; } }).map((l) => l.href.slice(0, 120)),
      adkillActive: document.documentElement.getAttribute('data-adkill') === 'on',
    };
  }).catch((e) => ({ evalError: String(e).slice(0, 200) }));

  if (shot) await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
  if (logReq) fs.writeFileSync(logReq, allReqs.join('\n'));
  await browser.close();

  // ---------- レポート ----------
  console.log(`=== ${target} ${noAdkill ? '(素の状態)' : '(adkill 適用)'} ===`);
  if (navError) console.log('NAV ERROR:', navError);
  console.log('metrics:', JSON.stringify(metrics));
  console.log(`blocked=${blocked.length} injected=${injected.length} netfail=${failed.length} console_err=${consoleErrs.length} (${Date.now() - t0}ms)`);
  const critical = blocked.filter((b) => ['stylesheet', 'script', 'document', 'font', 'xhr', 'fetch'].includes(b.type));
  if (critical.length) {
    console.log('--- ブロックされた CSS/JS/文書 (表示崩れの容疑者) ---');
    for (const b of critical) console.log(`  [${b.type}] ${b.url}\n      └ ${b.rule}`);
  }
  if (verbose) {
    console.log('--- 全ブロック ---');
    for (const b of blocked) console.log(`  [${b.type}] ${b.url}  <- ${b.rule}`);
    console.log('--- ネットワーク失敗 ---'); failed.slice(0, 10).forEach((f) => console.log('  ' + f));
  }
  if (consoleErrs.length) {
    console.log('--- console/page エラー (先頭10) ---');
    consoleErrs.slice(0, 10).forEach((c) => console.log('  ' + c));
  }
})();
