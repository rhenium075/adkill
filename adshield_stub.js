/*
 * adshield_stub.js — Ad-Shield loader.min.js の代替スタブ
 *
 * adkill_mitm.sgmodule の [URL Rewrite] が html-load.com / content-loader.com の
 * loader.min.js をこのファイル (cdn.jsdelivr.net 経由) に 302 で差し替える。
 *
 * 役割: 「loader は正常に実行された」ことを示すゲートフラグ
 *   window["as_" + hashCode(name + "_" + UTC日ms)] (前日/当日/翌日)
 * を立てるだけ。これでページ内のインライン復旧スクリプトが即 return し、
 * ドメインローテーション・CSS 全削除・全画面 iframe 壁・confirm ループが
 * すべて不発になる (newsdig.tbs.co.jp で実測した仕様。MITM 不可のサイトでも
 * loader の配信元ドメイン側は MITM できるため、この方式なら壁を止められる)。
 * 広告 SDK 本体の機能は一切実行しない。
 */
(function () {
  try {
    var now = Date.now(), day = now - now % 864e5;
    ["loader-check", "recovery"].forEach(function (nm) {
      [day - 864e5, day, day + 864e5].forEach(function (d) {
        var s = nm + "_" + d, h = 0;
        for (var i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
        window["as_" + h] = true;
      });
    });
  } catch (e) {}
})();
