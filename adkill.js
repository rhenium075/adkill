/*
 * adkill.js — 全サイト共通 http-response スクリプト
 * 対応: Shadowrocket / Surge / Loon (type=http-response, requires-body=1)
 *       Quantumult X (script-response-body)
 *
 * 役割:
 *  1. text/html 応答の <head> 直後に CSS + JS を注入
 *  2. 広告ライブラリ (adsbygoogle / googletag / googlefc) を「読み込めたふり」のスタブに差し替え
 *  3. アンチアドブロック検知ライブラリを読み込み時点で abort
 *  4. 「広告ブロッカーを無効にしてください」系オーバーレイを検出して除去、スクロールを復帰
 *  5. 施行 CSP を保持し、そのページでは注入を見送る
 */
(function () {
  // ---------- 注入を行わないホスト（サイトが壊れたらここに追加） ----------
  var SKIP_HOSTS = [
    'accounts.google.com',
    'appleid.apple.com',
    'login.microsoftonline.com',
    'checkout.stripe.com',
    'js.stripe.com'
  ];
  // CSS のみ注入(JS 注入なし)。SPA を壊さず広告枠だけ隠すライトモード
  // ※ newsdig は 2026-09-09 に除外: Ad-Shield 復旧スクリプト対策(A2 のゲートフラグ)は
  //   JS 注入が必須のため。MITM 復活後は full 注入で壁を不発化する
  var LITE_HOSTS = [];

  var res = (typeof $response !== 'undefined') ? $response : null;
  if (!res || typeof res.body !== 'string') { $done({}); return; }

  var url = '';
  try { url = ($request && $request.url) || ''; } catch (e) {}
  var host = '';
  try { host = url.replace(/^https?:\/\//, '').split('/')[0].split(':')[0].toLowerCase(); } catch (e) {}
  for (var s = 0; s < SKIP_HOSTS.length; s++) {
    if (host === SKIP_HOSTS[s] || host.endsWith('.' + SKIP_HOSTS[s])) { $done({}); return; }
  }
  var lite = false;
  for (var l = 0; l < LITE_HOSTS.length; l++) {
    if (host === LITE_HOSTS[l] || host.endsWith('.' + LITE_HOSTS[l])) { lite = true; break; }
  }

  var headers = res.headers || {};
  var keys = Object.keys(headers);
  function getH(name) { for (var i = 0; i < keys.length; i++) if (keys[i].toLowerCase() === name) return String(headers[keys[i]] || ''); return ''; }
  function delH(name) { for (var i = 0; i < keys.length; i++) if (keys[i].toLowerCase() === name) delete headers[keys[i]]; }

  var body = res.body;
  var ct = getH('content-type').toLowerCase();
  if (ct.indexOf('text/html') === -1) { $done({}); return; }
  if (body.indexOf('__adkill') !== -1) { $done({}); return; }             // 二重注入防止
  if (!/<(html|head|body)[\s>]/i.test(body.slice(0, 8192))) { $done({}); return; } // HTML断片は無視
  // 文字化けガード: UTF-8 以外 (Shift_JIS 等) を SR が誤デコードした痕跡 (U+FFFD) が
  // 多い body は触らない (注入して返すと壊れた文字列を確定させてしまうため)
  var head4k = body.slice(0, 4096), rep = 0;
  for (var ri = 0; ri < head4k.length; ri++) if (head4k.charCodeAt(ri) === 0xFFFD && ++rep > 8) { $done({}); return; }
  // CSP 保持 (レビュー R02): 施行 CSP を持つページは、CSP を削除して注入するのではなく
  // 注入自体を見送り、サイト本来の XSS 防御をそのまま残す。
  // (nonce 追記は 'unsafe-inline' を無効化して元ページのインラインを壊すため採用しない。
  //  Report-Only は遮断しないため注入可・ヘッダも保持)
  if (getH('content-security-policy')) { $done({}); return; }
  // meta CSP は head 全域を対象に、数値文字参照 (&#45; 等) を復号してから判定する
  // (再レビュー残件2: 先頭 16KB 限定・生文字列マッチでは、遅い配置や
  //  http-equiv="Content&#45;Security&#45;Policy" のような表記を見落とすため)
  var headEnd = body.search(/<\/head[\s>]/i);
  var headHtml = headEnd > 0 ? body.slice(0, headEnd) : body.slice(0, 262144);
  var metas = headHtml.match(/<meta[^>]*>/gi) || [];
  for (var mi = 0; mi < metas.length; mi++) {
    var mt = metas[mi]
      .replace(/&#x([0-9a-f]+);?/gi, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
      .replace(/&#(\d+);?/g, function (_, d) { return String.fromCharCode(parseInt(d, 10)); });
    if (/http-equiv\s*=\s*["']?\s*content-security-policy/i.test(mt)) { $done({}); return; }
  }

  // ---------- 注入する CSS ----------
  // ※ .ad / .ads / .adsbox / .textads などの "おとり要素" に使われる汎用名は意図的に隠さない
  //   （隠すと検知が成功してしまうため）。ドメイン遮断で中身は空になる。
  var CSS = [
    '<style id="__adkill_css">',
    // Google 系広告枠
    '[id^="div-gpt-ad"],[id^="google_ads_iframe"],[id^="google_ads_div"],#google_image_div,',
    // iframe の URL 部分一致 CSS は使わない (クエリ文字列の一致で誤爆するため)。
    'iframe[id^="google_ads"],iframe[name^="google_ads"],',
    // Google 検索結果の広告 (www.google.com / google.co.jp)
    '#tads,#tadsb,#bottomads,[data-text-ad],[data-text-ad="1"],.commercial-unit-mobile-top,.commercial-unit-desktop-top,',
    // アンチアドブロック UI（Funding Choices 等）
    '.fc-ab-root,.fc-message-root,.fc-consent-root .fc-ab-dialog,',
    // ※ "adblock"/"ad-block" の部分一致 CSS は置かない ("downloadblock"="downlo|adblock",
    //   "head-block" 等の無関係クラスにマッチして表示を壊すため — レビュー R03 で実証)。
    //   これらは JS sweep の境界付き正規表現でのみ扱う (瞬間表示は許容するコスト)
    '[class*="anti-adb" i],[id*="anti-adb" i],[class*="abp-notice" i]',
    '{display:none!important;visibility:hidden!important;height:0!important;min-height:0!important;}',
    // Ad-Shield が復元注入する広告の痕跡 (スペース詰めの寸法属性。uAssets の汎用ルールを移植)。
    // display:none だと復元側に検知されうるため visibility のみ
    'iframe[id][height^="  "],img[height^="  "][width^="  "],amp-img[width^="  "],ins[style*="--gn-ov-ad-height"]{visibility:hidden!important}',
    '</style>'
  ].join('');

  // ---------- 注入する JS ----------
  var JS = [
    '<script id="__adkill_js">(function(){',
    'if(window.__adkill)return;window.__adkill=1;',
    'var W=window,D=document,noop=function(){};',
    'try{D.documentElement.setAttribute("data-adkill","on")}catch(e){}',
    /* debug badge: example.com/org、または任意の URL に #adkill を付けると右下に表示（注入の生存確認用） */
    'try{if(/(^|\\.)(example\\.(com|org)|neverssl\\.com|httpforever\\.com)$/.test(location.hostname)||location.hash==="#adkill"){var b=D.createElement("div");b.textContent="adkill \\u2713";b.style.cssText="position:fixed;right:8px;bottom:8px;z-index:2147483647;background:#0a7d33;color:#fff;font:bold 14px sans-serif;padding:6px 10px;border-radius:6px";var badd=function(){(D.body||D.documentElement).appendChild(b)};if(D.body){badd()}else{D.addEventListener("DOMContentLoaded",badd)}}}catch(e){}',

    /* A. 広告ライブラリのスタブ（読み込めた"ふり"） */
    'try{',
    'var ag=Array.isArray(W.adsbygoogle)?W.adsbygoogle:[];ag.loaded=true;ag.push=noop;ag.pauseAdRequests=0;',
    'try{Object.defineProperty(W,"adsbygoogle",{configurable:true,get:function(){return ag},set:noop})}catch(e){W.adsbygoogle=ag}',
    'var slot={};["addService","setTargeting","setCollapseEmptyDiv","defineSizeMapping","clearTargeting","set","setConfig"].forEach(function(k){slot[k]=function(){return slot}});',
    'slot.getSlotElementId=function(){return""};slot.getTargeting=function(){return[]};',
    'var pub={};["refresh","addEventListener","removeEventListener","setTargeting","clearTargeting","enableSingleRequest","enableAsyncRendering","collapseEmptyDivs","disableInitialLoad","enableLazyLoad","setPrivacySettings","setPublisherProvidedId","setRequestNonPersonalizedAds","clear","set","setCentering","setForceSafeFrame","enableVideoAds","updateCorrelator","setCookieOptions"].forEach(function(k){pub[k]=function(){return pub}});',
    'pub.getSlots=function(){return[]};pub.getTargeting=function(){return[]};pub.isInitialLoadDisabled=function(){return false};',
    'var gt={cmd:{push:function(f){try{typeof f==="function"&&f()}catch(e){}return 1}},pubads:function(){return pub},companionAds:function(){return pub},defineSlot:function(){return slot},defineOutOfPageSlot:function(){return slot},enableServices:noop,display:noop,destroySlots:function(){return true},sizeMapping:function(){var b={addSize:function(){return b},build:function(){return[]}};return b},apiReady:true,pubadsReady:true,setConfig:noop,getVersion:function(){return"adkill"},openConsole:noop};',
    /* 先にスタブを据えてから旧キューを流す（旧 googletag には defineSlot 等が無く、逆順だと全コールバックが失敗する） */
    'var oldq=(W.googletag&&Array.isArray(W.googletag.cmd))?W.googletag.cmd:[];',
    'W.googletag=gt;',
    'oldq.forEach(function(f){try{typeof f==="function"&&f()}catch(e){}});',
    'var fc=W.googlefc||{};fc.callbackQueue={push:noop};fc.controlledMessagingFunction=noop;fc.ccpa={};',
    'fc.getAdBlockerStatus=function(){return 3};fc.AdBlockerStatusEnum={UNKNOWN:0,EXTENSION_LEVEL_AD_BLOCKER:1,NETWORK_LEVEL_AD_BLOCKER:2,NO_AD_BLOCKER:3};',
    'fc.showRevocationMessage=noop;W.googlefc=fc;',
    'W.canRunAds=true;W.isAdBlockActive=false;W.adBlockDetected=false;W.adblock=false;W.abp=false;W.ad_blocked=false;W.adblockEnabled=false;',
    '}catch(e){}',

    /* A2. Ad-Shield (html-load.com/content-loader.com 系。旧記載 Admiral は誤り) 対策:
       インライン復旧スクリプトは window["as_"+hash(name+"_"+UTC日ms)] が立っていると即 return する
       (本来は loader.min.js が実行成功時に立てるフラグ)。先に立てて壁ロジックごと不発化する。
       hash は ((h<<5)-h+charCode)|0 の Java 型 hashCode (newsdig で実測・デコード確認済み) */
    'try{var _ad=Date.now()-Date.now()%864e5;["loader-check","recovery"].forEach(function(nm){[_ad-864e5,_ad,_ad+864e5].forEach(function(dd){var st=nm+"_"+dd,h=0;for(var i=0;i<st.length;i++){h=(h<<5)-h+st.charCodeAt(i);h|=0}W["as_"+h]=true})})}catch(e){}',

    /* B. 検知ライブラリを読み込み時点で殺す (abort-on-property-read 相当) */
    '["blockAdBlock","BlockAdBlock","fuckAdBlock","FuckAdBlock","sniffAdBlock","SniffAdBlock","adblockDetector","AdBlockDetector","detectAdBlock","adBlockDetect","AdblockDetector","checkAdBlock","AdBlockCheck","kill_ad_block"].forEach(function(n){',
    'try{Object.defineProperty(W,n,{configurable:false,enumerable:false,get:function(){throw new ReferenceError(n+" is not defined")},set:noop})}catch(e){}});',

    /* C. オーバーレイ掃除 & スクロール復帰 */
    'var RE=/\\u5e83\\u544a\\u30d6\\u30ed\\u30c3\\u30af|\\u5e83\\u544a\\u30d6\\u30ed\\u30c3\\u30ab\\u30fc|\\u30a2\\u30c9\\u30d6\\u30ed\\u30c3\\u30af|\\u5e83\\u544a\\u3092(\\u8868\\u793a|\\u8a31\\u53ef)|\\u30db\\u30ef\\u30a4\\u30c8\\u30ea\\u30b9\\u30c8|ad[\\s-]?block|adblocker|(disable|turn off|pause|switch off|deactivate)[^.]{0,60}(ad ?block|blocker)|whitelist (us|our site|this site)|allow ads/i;',
    'var SEL=\'[class*="adblock" i],[id*="adblock" i],[class*="ad-block" i],[id*="ad-block" i],.fc-ab-root,.fc-message-root,[role="dialog"],[role="alertdialog"],[class*="modal" i],[id*="modal" i],[class*="overlay" i],[id*="overlay" i],[class*="popup" i],[id*="popup" i],[class*="paywall" i],[id*="paywall" i],[class*="lightbox" i],[class*="interstitial" i],[class*="blocker" i]\';',
    'var killed=0;',
    /* position/height はスクロールロック(position:fixed)の時だけ戻す。無条件に static 化すると position:relative 前提のレイアウトが壊れる */
    'function unlock(){try{[D.documentElement,D.body].forEach(function(el){if(!el)return;el.style.setProperty("overflow","auto","important");el.style.setProperty("overflow-y","auto","important");if(getComputedStyle(el).position==="fixed"){el.style.setProperty("position","static","important");el.style.setProperty("height","auto","important")}["modal-open","no-scroll","noscroll","overflow-hidden","scroll-lock","is-locked","has-modal","fc-ab-root","stop-scrolling","body-lock"].forEach(function(c){el.classList.remove(c)})})}catch(e){}}',
    // 無関係な全画面要素は削除しない。バックドロップはサイト個別の対策に限定する。
    /* アンチアドブロック壁の全画面 iframe (Ad-Shield: error-report.com/modal, z-index 2147483647 実測) を除去。
       URL のホスト境界と /modal パスを検証。見た目や z-index のみでは削除しない */
    'function wallframes(){try{var fr=D.querySelectorAll("iframe");for(var i=0;i<fr.length;i++){var f=fr[i];if(!f.isConnected)continue;var u;try{u=new URL(f.getAttribute("src")||"",location.href)}catch(e){continue}var h=u.hostname.toLowerCase();if(/^https?:$/.test(u.protocol)&&(h==="error-report.com"||h.endsWith(".error-report.com"))&&/^\\/modal(?:\\/|$)/.test(u.pathname)){f.remove();killed++}}}catch(e){}}',
    /* R03/R04 対策: 文書ルート(body/html/main)と、main/article を内包する要素は削除しない。
       非オーバーレイ要素の削除は「名前 (byName) と文言 (byText) が両方一致」した場合のみ —
       文字数ヒューリスティックは短い本文・描画前の空ラッパーを通知と誤認するため廃止
       (再レビュー残件1)。オーバーレイも byName と byText の両方が必要。unlock は「このパスで実際に除去があったとき」だけ実行 */
    'function sweep(){if(!D.body)return;var pre=killed;wallframes();try{var c=D.querySelectorAll(SEL);for(var i=0;i<c.length;i++){var el=c[i];if(!el.isConnected)continue;if(el===D.body||el===D.documentElement||/^(BODY|HTML|MAIN|ARTICLE)$/.test(el.tagName))continue;try{if(el.getAttribute("role")==="main"||el.querySelector("main,article,[role=\\"main\\"]"))continue}catch(e){}var idc=(el.className&&el.className.baseVal!==undefined?el.className.baseVal:el.className||"")+" "+(el.id||"");var t=(el.innerText||"").slice(0,4000);var byName=/(^|[^a-z])ad[-_]?block|fc-ab-|anti-adb/i.test(idc);var byText=RE.test(t);var hit=byName&&byText;if(el.querySelector("form,input,textarea,select,[contenteditable]"))continue;if(hit){el.remove();killed++}}}catch(e){}if(killed>pre){unlock()}}',
    'var t0=Date.now(),timer=setInterval(function(){sweep();if(Date.now()-t0>25000)clearInterval(timer)},600);',
    'D.addEventListener("DOMContentLoaded",sweep);W.addEventListener("load",sweep);',
    'try{var pend=false;new MutationObserver(function(){if(pend)return;pend=true;setTimeout(function(){pend=false;sweep()},150)}).observe(D.documentElement,{childList:true,subtree:true})}catch(e){}',

    // D. ページ本来の setTimeout を保持する (文字列一致による正常処理の抑止を防止)。

    /* E. 空になった広告枠の折り畳み（ブロック後の空白対策）。
       検知ライブラリの多くは読み込み直後〜数秒で判定するため、load 後 2 秒まで待ってから畳む
       (A/B の abort・スタブが主要な検知を無力化している前提の残余リスクとして許容)。
       対象は「実スロット」のみ: 中身が空の ins.adsbygoogle と、CSS/本処理で隠れた広告要素
       しか含まない高さ持ちの親ラッパー (2 階層まで)。bait 用の汎用 .ad/.ads は触らない */
    'function adFrame(f){if(f.getAttribute("data-adkill-collapsed"))return true;try{var u=new URL(f.getAttribute("src")||"",location.href),h=u.hostname.toLowerCase();return /^https?:$/.test(u.protocol)&&["doubleclick.net","googlesyndication.com","amazon-adsystem.com"].some(function(d){return h===d||h.endsWith("."+d)})}catch(e){return false}}',
    /* canvas/embed/object/audio/picture も「内容あり」として保護 (再レビュー: canvas グラフ誤爆) */
    'function emptyOfContent(p){if((p.innerText||"").trim())return false;if(p.querySelector("img,video,audio,canvas,embed,object,picture,input,button,a,svg,textarea,select"))return false;var ifr=p.getElementsByTagName("iframe");for(var k=0;k<ifr.length;k++){if(!adFrame(ifr[k]))return false}return true}',
    'function collapseSlots(){try{',
    'var ins=D.querySelectorAll("ins.adsbygoogle");for(var i=0;i<ins.length;i++){var el=ins[i];if(el.getAttribute("data-adkill-collapsed"))continue;if(!emptyOfContent(el))continue;var r=el.getBoundingClientRect();if(r.height<20&&r.width<20)continue;el.setAttribute("data-adkill-collapsed","1");el.style.setProperty("display","none","important")}',
    'var hid=D.querySelectorAll(\'[data-adkill-collapsed],[id^="div-gpt-ad"],[id^="google_ads_iframe"]\');for(var j=0;j<hid.length;j++){var p=hid[j].parentElement;for(var up=0;up<2&&p;up++){if(p===D.body||p===D.documentElement||/^(BODY|HTML|MAIN|ARTICLE|SECTION|HEADER|FOOTER|NAV)$/.test(p.tagName))break;if(!emptyOfContent(p))break;var pr=p.getBoundingClientRect();if(pr.height<20)break;p.setAttribute("data-adkill-collapsed","1");p.style.setProperty("display","none","important");p=p.parentElement}}',
    '}catch(e){}}',
    'W.addEventListener("load",function(){setTimeout(collapseSlots,2000);setTimeout(collapseSlots,6000)});',

    '})();</scr' + 'ipt>'
  ].join('');

  var PAYLOAD = lite ? CSS : (CSS + JS);

  // ---------- 改変に伴うヘッダ調整 ----------
  // ※ CSP は削除しない (施行 CSP のあるページはこの地点に到達しない — 上の R02 ガード参照)
  delH('content-length');   // body 改変後の長さ不一致による切り詰めを防ぐ
  delH('content-encoding'); // SR は復号済み body を渡すため、圧縮ヘッダが残ると
                            // クライアント側のデコード失敗で白画面/表示崩れになる (防御的削除)

  // ---------- Ad-Shield スクリプトを HTML から除去 (MITM 可能サイト向け) ----------
  // trafficnews.jp 等は sdk.js を <script data-sdk="l/..." onload="(難読化アンチタンパー)"> で
  // 読み、別に <script data-cfasync="false" nowprocket>(難読化復旧)</script> を持つ。
  // ドメイン遮断だと onload/復旧が「loader 失敗」を検知して壁を出す(=白画面)。
  // MITM で HTML を触れるならスクリプトごと消すのが最も確実(uBlock と同じ発想)。
  // ① data-sdk="l/…" を持つ loader (onload 属性ごと)
  body = body.replace(/<script\b[^>]*\bdata-sdk\s*=\s*["']l\/[^"']*["'][^>]*>[\s\S]*?<\/script>/gi, '');
  // ② nowprocket を持ち、Ad-Shield 難読化(文字組立て関数)を含む独立復旧スクリプト。
  //    nowprocket 単体は WP Rocket 除外で正当なため、シグネチャ一致時のみ除去(誤爆防止)
  var ADSHIELD_SIG = /=\([a-z],([a-z]),[a-z]\)=>\{for\(\1=\1\|\|/;
  body = body.replace(/<script\b[^>]*\bnowprocket\b[^>]*>[\s\S]*?<\/script>/gi, function (m) {
    return ADSHIELD_SIG.test(m) ? '' : m;
  });

  // ---------- 注入位置 ----------
  // <head[^>]*> だと <header ...> にもマッチするため、タグ名直後は空白か ">" に限定する
  var HEAD_RE = /<head(?:\s[^>]*)?>/i, BODY_RE = /<body(?:\s[^>]*)?>/i;
  var out;
  if (HEAD_RE.test(body)) {
    out = body.replace(HEAD_RE, function (m) { return m + PAYLOAD; });
  } else if (BODY_RE.test(body)) {
    out = body.replace(BODY_RE, function (m) { return m + PAYLOAD; });
  } else {
    out = PAYLOAD + body;
  }

  $done({ body: out, headers: headers });
})();
