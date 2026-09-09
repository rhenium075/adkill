# adkill テストスイート

実機 (iPhone + Shadowrocket) なしで adkill を検証するための疑似環境。
ルールやスクリプトを変更したら push 前にここを通すこと。

| ファイル | 内容 |
|---|---|
| `harness.js` | Shadowrocket の `$request`/`$response`/`$done` をモックし、adkill.js の応答書き換え（注入位置・CSP/Content-Length 除去・SKIP/LITE_HOSTS・二重注入防止・ASCII 安全性など）を検証 |
| `dom_test.js` | jsdom 上で注入後ペイロードを実行し、adsbygoogle/googletag スタブ・検知 abort・アンチアドブロック壁の除去・スクロール復帰・正当要素の誤爆なしを検証（jsdom にはレイアウトが無いため rect/innerText をパッチ） |
| `rules_test.js` | adkill_custom.list / adkill_jp.list / adkill.conf / adkill_mitm.sgmodule の構文検証、URL-REGEX の遮断・素通しコーパス、custom.list ↔ adguard_dns_userrules.txt の対保守同期チェック、ca-p12 混入チェック |
| `adshield_test.js` | Ad-Shield 系アンチアドブロック壁（newsdig で実測した復旧スクリプト仕様のクリーンルーム再現 `fixtures/adshield_recovery_sim.js`）に対する、ゲートフラグ不発化・壁 iframe 除去・誤爆なしの検証 |
| `test_convert.py` | tools/convert_jp_filter.py の変換ロジック（モックフェッチ）と、フェッチ失敗時に既存リストを壊さないことの検証 |
| `e2e_browser_test.js` | **実ブラウザ (Playwright + Chromium) での E2E**。実物の FuckAdBlock / IAB AdBlockDetection ライブラリ（初回に `.cache/` へ取得）、bait 要素の実レイアウト可視性、Ad-Shield 壁の発動（コントロール群）と不発化、sweep・スクロール復帰を、拡張機能なしの実エンジンで検証。ネットワークは page.route で全遮断 |

## 実行

```
cd tools/tests
npm install        # 初回のみ (jsdom)
npm test           # jsdom 系 + ルール検証 (E2E は含まない)
```

E2E (任意・要 Playwright):

```
npm i -D playwright && npx playwright install chromium
node e2e_browser_test.js
# CDN 不達時は既存の Chromium を PLAYWRIGHT_CHROMIUM_PATH で指定可能
```

Node 18+ / Python 3.9+。dom_test.js / adshield_test.js / e2e 以外は依存なしで単体実行できる。
