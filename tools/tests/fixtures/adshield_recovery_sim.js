/*
 * adshield_recovery_sim.js — Ad-Shield 系アンチアドブロック壁の「復旧スクリプト」挙動の
 * 観測仕様の再実装 (newsdig.tbs.co.jp で 2026-09-09 に実測・難読化解除して確認した仕様)。
 * 実物の難読化コードは含めない。テスト専用。
 *
 * 実測仕様:
 *  - ゲート: window["as_" + hashCode(name + "_" + UTC日ms)] (前日/当日/翌日) のいずれかが
 *    立っていれば即 return。フラグ名 "loader-check"。本来は loader.min.js が実行成功時に立てる
 *  - hashCode: Java 型 ((h<<5)-h+charCode)|0
 *  - loader 全ドメイン (html-load.com / fb.html-load.com / content-loader.com /
 *    fb.content-loader.com) 失敗後: error-report.com へ報告 POST →
 *    document.querySelectorAll("link,style") を全削除 →
 *    report.error-report.com/modal を src とする全画面 iframe (z-index 2147483647) を追加 →
 *    3 秒以内に iframe から postMessage("as_modal_loaded") が来なければ confirm() →
 *    OK で誘導ページへ遷移 / キャンセルで location.reload()
 */
(function () {
  function hashCode(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
    return h;
  }
  function gateOpen(name) {
    var now = Date.now(), day = now - now % 864e5;
    var keys = [day - 864e5, day, day + 864e5].map(function (d) { return 'as_' + hashCode(name + '_' + d); });
    for (var i = 0; i < keys.length; i++) if (window[keys[i]]) return false;
    return true;
  }
  if (!gateOpen('loader-check')) return; // loader 実行済み → 何もしない

  // (ローテーションは省略: 全ドメイン失敗後の壁経路を直接再現)
  fetch('https://error-report.com/report', { method: 'POST' })
    .catch(function () { return { text: function () { return Promise.resolve('error'); } }; })
    .then(function (r) { return r.text(); })
    .then(function (eventId) {
      document.querySelectorAll('link,style').forEach(function (el) { el.remove(); });
      var received = false;
      window.addEventListener('message', function (ev) { if (ev.data === 'as_modal_loaded') received = true; });
      var i = document.createElement('iframe');
      i.src = 'https://report.error-report.com/modal?eventId=' + eventId + '&error=x&domain=html-load.com&url=' + btoa(location.href);
      i.setAttribute('style', 'width: 100vw; height: 100vh; z-index: 2147483647; position: fixed; left: 0; top: 0;');
      document.documentElement.appendChild(i);
      var done = false;
      var watchdog = setInterval(function () {
        if (!document.contains(i)) return clearInterval(watchdog); // 除去は黙認 (実測)
        var r = i.getBoundingClientRect();
        if ((getComputedStyle(i).display === 'none' || !r.width || !r.height) && !done) {
          clearInterval(watchdog); done = true; punish();
        }
      }, 1000);
      setTimeout(function () { if (!received && !done) { done = true; punish(); } }, 3000);
      function punish() {
        if (confirm('There was a problem loading the page. Please click OK to learn more.')) {
          location.href = 'https://report.error-report.com/modal?eventId=&error=x';
        } else {
          location.reload();
        }
      }
    });
})();
