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
 *  5. 注入スクリプトを妨げる CSP ヘッダ / meta を除去
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

  // ---------- 注入する CSS ----------
  // ※ .ad / .ads / .adsbox / .textads などの "おとり要素" に使われる汎用名は意図的に隠さない
  //   （隠すと検知が成功してしまうため）。ドメイン遮断で中身は空になる。
  var CSS = [
    '<style id="__adkill_css">',
    // Google 系広告枠
    '[id^="div-gpt-ad"],[id^="google_ads_iframe"],[id^="google_ads_div"],#google_image_div,',
    'iframe[src*="doubleclick.net"],iframe[src*="googlesyndication"],iframe[src*="adservice."],iframe[src*="/ads/"],iframe[src*="adsystem"],',
    'iframe[id^="google_ads"],iframe[name^="google_ads"],',
    // Google 検索結果の広告 (www.google.com / google.co.jp)
    '#tads,#tadsb,#bottomads,[data-text-ad],[data-text-ad="1"],.commercial-unit-mobile-top,.commercial-unit-desktop-top,',
    // アンチアドブロック UI（Funding Choices 等）
    '.fc-ab-root,.fc-message-root,.fc-consent-root .fc-ab-dialog,',
    // ※ "ad-block" の部分一致 CSS は置かない ("head-block" "thread-block" 等の無関係クラスに
    //   マッチして表示を壊すため)。ハイフン形は JS sweep の境界付き正規表現でのみ除去する
    '[class*="adblock" i]:not(body):not(html),[id*="adblock" i]:not(body):not(html),',
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
    'function big(el){try{var cs=getComputedStyle(el);if(!/fixed|absolute|sticky/.test(cs.position))return false;var r=el.getBoundingClientRect();return r.width>=innerWidth*0.5&&r.height>=innerHeight*0.3}catch(e){return false}}',
    /* position/height はスクロールロック(position:fixed)の時だけ戻す。無条件に static 化すると position:relative 前提のレイアウトが壊れる */
    'function unlock(){try{[D.documentElement,D.body].forEach(function(el){if(!el)return;el.style.setProperty("overflow","auto","important");el.style.setProperty("overflow-y","auto","important");if(getComputedStyle(el).position==="fixed"){el.style.setProperty("position","static","important");el.style.setProperty("height","auto","important")}["modal-open","no-scroll","noscroll","overflow-hidden","scroll-lock","is-locked","has-modal","fc-ab-root","stop-scrolling","body-lock"].forEach(function(c){el.classList.remove(c)})})}catch(e){}}',
    'function backdrops(){try{var all=D.body.querySelectorAll("div,section,aside");for(var i=0;i<all.length;i++){var el=all[i];var cs=getComputedStyle(el);if(cs.position!=="fixed")continue;var r=el.getBoundingClientRect();if(r.width>=innerWidth*0.9&&r.height>=innerHeight*0.9&&(el.innerText||"").trim().length<20&&el.querySelectorAll("img,video,iframe,input,button,a,svg").length===0){el.remove()}}}catch(e){}}',
    /* アンチアドブロック壁の全画面 iframe (Ad-Shield: error-report.com/modal, z-index 2147483647 実測) を除去。
       誤爆防止のため src が壁ベンダーのものか、z-index がほぼ最大値の fixed 全画面のみ対象 */
    'function wallframes(){try{var fr=D.querySelectorAll("iframe");for(var i=0;i<fr.length;i++){var f=fr[i];if(!f.isConnected)continue;var src=f.getAttribute("src")||"";if(/error-report\\.com|\\/modal\\?eventId=/.test(src)){f.remove();killed++;continue}var cs=getComputedStyle(f);if(cs.position!=="fixed")continue;var z=parseInt(cs.zIndex,10)||0;var r=f.getBoundingClientRect();if(z>=2147480000&&r.width>=innerWidth*0.9&&r.height>=innerHeight*0.9){f.remove();killed++}}}catch(e){}}',
    'function sweep(){if(!D.body)return;wallframes();try{var c=D.querySelectorAll(SEL);for(var i=0;i<c.length;i++){var el=c[i];if(!el.isConnected)continue;var idc=(el.className&&el.className.baseVal!==undefined?el.className.baseVal:el.className||"")+" "+(el.id||"");var t=(el.innerText||"").slice(0,4000);var byName=/(^|[^a-z])ad[-_]?block|fc-ab-|anti-adb/i.test(idc);var byText=RE.test(t);if(byName||(byText&&big(el))){el.remove();killed++}}}catch(e){}if(killed){unlock();backdrops()}}',
    'var t0=Date.now(),timer=setInterval(function(){sweep();if(Date.now()-t0>25000)clearInterval(timer)},600);',
    'D.addEventListener("DOMContentLoaded",sweep);W.addEventListener("load",sweep);',
    'try{var pend=false;new MutationObserver(function(){if(pend)return;pend=true;setTimeout(function(){pend=false;sweep()},150)}).observe(D.documentElement,{childList:true,subtree:true})}catch(e){}',

    /* D. 検知用の setTimeout(…, 検知関数) を潰す軽い保険：関数ソースに検知ライブラリ名が含まれれば実行しない。
       canRunAds / isAdBlockActive は含めない — スタブが正しい値を返すため実行させた方が
       「else で本文を表示する」正当な分岐を通せる（含めると本文表示側ごと握り潰す誤爆になる） */
    'try{var _st=W.setTimeout;W.setTimeout=function(f,ms){try{if(typeof f==="function"&&/blockadblock|fuckadblock|adblock[-_ ]?detect|detect[-_ ]?adblock/i.test(Function.prototype.toString.call(f)))return 0}catch(e){}return _st.apply(W,arguments)}}catch(e){}',

    '})();</scr' + 'ipt>'
  ].join('');

  var PAYLOAD = lite ? CSS : (CSS + JS);

  // ---------- CSP 除去（インライン注入を通すため） ----------
  delH('content-security-policy');
  delH('content-security-policy-report-only');
  delH('content-length');   // body 改変後の長さ不一致による切り詰めを防ぐ
  delH('content-encoding'); // SR は復号済み body を渡すため、圧縮ヘッダが残ると
                            // クライアント側のデコード失敗で白画面/表示崩れになる (防御的削除)
  body = body.replace(/<meta[^>]+http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi, '');

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
