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
| `sr_emulator.js` | **Shadowrocket 挙動エミュレータ**。実サイトを読み込みながら、フルルールセット (custom → jp → 上流3本) の評価 + REJECT-TINYGIF (1x1 GIF 応答) + adkill.js の MITM 注入 + AdGuard DoH の DNS 層 (`--dns`) を再現。`--webkit` で iOS 相当エンジン、`--no-inject` で文書注入のみ停止、`--no-mitm` で ca-p12 消失/未信頼 (復号全停止) 状態、`--no-adkill` で素の状態を再現し、「どのリソースがどのルールで潰されたか」を報告。実機で表示崩れが出たらまずこれで再現を試みる: `node sr_emulator.js <url> --dns --webkit --shot out.png` |
| `e2e_browser_test.js` | **実ブラウザ (Playwright + Chromium) での E2E**。実物の FuckAdBlock / IAB AdBlockDetection ライブラリ（初回に `.cache/` へ取得）、bait 要素の実レイアウト可視性、Ad-Shield 壁の発動（コントロール群）と不発化、sweep・スクロール復帰を、拡張機能なしの実エンジンで検証。ネットワークは page.route で全遮断 |

## 実行

```
cd tools/tests
npm install        # 初回のみ (jsdom)
npm test           # jsdom 系 + ルール検証 (E2E は含まない)
```

E2E (要 Playwright):

```
npm i -D playwright && npx playwright install chromium
npm run e2e        # Playwright 未導入なら exit 0 でスキップ
npm run test:all   # jsdom 系 + E2E。E2E スキップは失敗扱い (--required)
# CDN 不達時は既存の Chromium を PLAYWRIGHT_CHROMIUM_PATH で指定可能
```

Node 18+ / Python 3.9+。dom_test.js / adshield_test.js / e2e 以外は依存なしで単体実行できる。

再現性: `package-lock.json` を追跡し、外部検知ライブラリ (FuckAdBlock / IAB) は
コミット SHA 固定で取得する (e2e_browser_test.js の LIBS を参照)。


## 敵対的レビューの回帰テスト

`npm test` に実効設定の変更注入、文書 URL 境界、固定コミット読み込み、実際の302応答、
DOM 誤削除、転送先審査、JP 例外の意味保存を追加した。GitHub Actions の `tests / regression`
は依存をインストールし、通常テストと必須 Chromium E2E を実行する。ブランチ保護の
必須チェック指定はリポジトリ設定のため、この PR だけでは保証しない。

`sr_emulator.js` は標準では固定コミットのコードを読むため、Git 履歴が必要。
`ADKILL_JS` は開発時のみ使用する。302先は実際に取得し、ローカルスタブで置き換えない。
非文書の本文処理一致・Connection:close・上限超過・応答処理失敗は未検証条件として
非ゼロ終了する。TLS/Shadowrocket の設定解析や実機のメモリ・ストリーミングは再現しない。
