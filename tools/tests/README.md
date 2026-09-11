# adkill の検証

## 通常テストと配布参照

Node 22 / Python 3.12 を CI の基準とする。リポジトリを Git 履歴付きで取得し、次を実行する。

```sh
cd tools/tests
npm ci
npm test
npm run test:release
```

`npm test` は作業ツリーの実装を検証する。応答処理（CSP 保持、本文注入、ヘッダ調整）、DOM とフォーム保護、広告検知ライブラリのスタブ、ルール構文、設定全体のスクリプト定義、MITM と本文の許可範囲、配布参照検証器の反例、JP 変換、サイト審査を含む。jsdom はレイアウトと innerText の一部を模擬するため、CSS と可視性はブラウザ E2E でも確認する。

`npm run test:release` は module の実行コード全5参照を解析し、同じ固定コミットを指すこと、全ファイルが Git 履歴に実在すること、作業ツリーの adkill.js / adshield_stub.js とバイト単位で一致することを確認する。通常テスト中の参照検査は作業ツリー一致を要求しないので、参照更新前の実装を試せる。リリース前には両コマンドの成功が必要。

実装を変更した直後は `test:release` の不一致が想定される。まず `npm test` を通して実装コミットを作り、リポジトリルートから `python3 tools/pin_release.py <実装コミットの完全SHA>` を実行する。その後、`test:release` と必須 E2E を通し、参照更新を別コミットにする。参照先を架空の SHA にして検証を通す運用にはしない。

## ブラウザ E2E

```sh
npm install --no-save --package-lock=false playwright@1.62.1
npx playwright install chromium
npm run test:all
```

`test:all` は通常テストと必須 Chromium E2E を実行する。Linux でブラウザの OS 依存が不足する場合は管理された環境で導入する。CI は `playwright install --with-deps chromium` を使用する。任意の `npm run e2e` は Playwright 未導入時にスキップするため、リリース判定には使わない。

E2E は作業ツリーの注入コードを合成ページに直接適用し、既知壁が除去されること、通常の記事・フォーム・編集領域が CSS でも非表示にならないこと、広告枠・おとり要素のレイアウトを検査する。newsdig 等の実サイトへの適用条件、配布 CDN、TLS 復号、Shadowrocket のパーサを検証するものではない。

外部の FuckAdBlock / IAB 検知ライブラリは `e2e_browser_test.js` の固定 SHA から初回取得し、その後ブラウザの通信は route で制御する。Ad-Shield の fixture は観測仕様の再実装であり、独立したクリーンルーム手続きの証明ではない。各素材の条件は [第三者通知](../../THIRD_PARTY_NOTICES.md) を参照。

## 実サイトのエミュレーション

```sh
node sr_emulator.js "https://example.com/" --dns
```

標準では module に固定したコミットのコードを読む。`ADKILL_JS` は開発用の明示的な上書きで、配布版の検証とは扱わない。リライトの302先は実際に取得し、ローカルスタブの成功応答に置き換えない。

非文書が本文 pattern に一致した場合、Connection:close、上限超過、応答処理失敗は未検証として非ゼロ終了する。WebKit オプションも iOS/Shadowrocket 実機を再現するものではない。実機のメモリ、ストリーミング、証明書、追加モジュールの設定合成は別途確認する。

GitHub Actions は `npm test`、`test:release`、必須 Chromium E2E を実行する。ブランチ保護の必須チェック設定はリポジトリ設定であり、このコードだけでは保証しない。
