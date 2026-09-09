# adkill — iOS 端末内完結の広告・アンチアドブロック除去

iPhone 17 (iOS 26) + Shadowrocket で、Chrome / Google アプリ含む全アプリの
Web 広告と「広告ブロッカーを無効にしてください」表示を除去するプロジェクト。

## 構成ファイル

| ファイル | 役割 |
|---|---|
| `adkill.conf` | Shadowrocket 用コンフィグ。DNS(AdGuard DoH)・RULE-SET 参照・adkill.js 注入・MITM ホスト名/除外リスト。**原則、編集禁止**: 端末側で conf を再取得すると ca-p12 が消えて復号が止まるため、ルール変更は adkill_custom.list で行う |
| `adkill_custom.list` | **独自ルールの本体(元 conf 直書き分)**。広告ドメイン・URL-REGEX を格納。日常の追加・削除はすべてここ。接続時に自動取得されるので端末操作不要 |
| `adkill.js` | 全 text/html 応答に注入されるスクリプト。adsbygoogle/googletag/googlefc のスタブ化、検知ライブラリの abort、アンチアドブロックオーバーレイの除去とスクロール復帰、CSP 除去とセットで動く |
| `adkill_jp.list` | AdGuard Japanese Filter から変換した DOMAIN-SUFFIX の RULE-SET（自動生成。**手で編集しない**） |
| `tools/convert_jp_filter.py` | 上記の生成スクリプト。`python3 tools/convert_jp_filter.py -o adkill_jp.list` で再生成 |
| `adguard_dns_userrules.txt` | AdGuard DNS（プライベートサーバー）のカスタムブロックリスト。conf と対 |
| `adkill.sgmodule` / `adkill_quantumultx.conf` | Surge/Loon 用モジュールと Quantumult X 用断片（現在は未使用の代替） |
| `tools/tests/` | 疑似環境テスト（Shadowrocket モック・jsdom・ルール構文/誤爆/対保守同期チェック）。**ルールや adkill.js を変更したら push 前に `cd tools/tests && npm test`** |

## 設計原則

1. **遮断ではなく偽装**: 広告リクエストは REJECT（切断）ではなく REJECT-TINYGIF（200 + 1x1 GIF）。
   読み込み失敗を検知するアンチアドブロックを回避するため。DNS 層より MITM 層を優先する理由も同じ。
2. **おとり要素は隠さない**: `.ad` `.ads` 等の汎用クラスを CSS で隠すと検知される。
   ドメイン遮断で中身を空にし、枠は個別セレクタでのみ消す。
3. **壊さない**: 証明書ピンニングのあるアプリ（Apple/Google API・LINE・金融・決済）は
   `[MITM] hostname` の `-` 除外に維持。サイト固有の不具合は adkill.js の SKIP_HOSTS で注入だけ止めるのが第一手。
4. **CNAME クローキング対策**: `ads.` `pagead.` `delivery.` 等で始まるホストは URL-REGEX で一括処理
   （例: atzzrq.tbs.co.jp のような第一者偽装）。

## よくある作業

### 広告が素通りしたとき（ユーザーから Shadowrocket データタブのログが来る）
1. FINAL,DIRECT になっている広告ドメインを特定
2. `adkill_custom.list` に `DOMAIN-SUFFIX,<domain>` を追加（**ポリシーは書かない** — conf の
   RULE-SET 行が REJECT-TINYGIF を付与する。conf 本体は編集禁止: ca-p12 が消える）
3. `adguard_dns_userrules.txt` にも `||<domain>^` を追加（2ファイルは対で保守）
4. commit & push → ユーザーに「コンフィグ更新 → 接続 OFF/ON → テストルールで確認」を案内

### JP リストの更新
`python3 tools/convert_jp_filter.py -o adkill_jp.list` → commit。
出典は AdguardTeam/AdguardFilters (GPLv3)。ヘッダの帰属表示を消さないこと。

### サイトが壊れたとき
- SSL エラー / アプリが接続不可(証明書ピンニング) / ECH サイトで TLS 失敗 →
  **`adkill_mitm.sgmodule` の `%APPEND%` 行に `-そのドメイン` を追加**(conf は触らない。
  conf を更新すると ca-p12 が消えるため、MITM 除外は必ずこのモジュールで管理する)
- 表示崩れ/ログイン不可 → `adkill.js` 冒頭の `SKIP_HOSTS` にホスト追加（軽い方から試す）

## デバイス側の反映手順（ユーザーに案内する定型文）
1. Shadowrocket: コンフィグタブ → adkill.conf を左スワイプ → 更新（無ければ 設定 → 更新 → コンフィグ）
2. ホームタブ: 接続 OFF → ON
3. コンフィグ → テストルール で対象ドメインが REJECT-TINYGIF になるか確認

## 重要な運用注意: リモート conf 更新と CA 証明書
Shadowrocket は MITM 用 CA の秘密鍵 (ca-p12) をローカルの conf に書き込む。
リモート更新で conf が上書きされると ca-p12 が消え、**復号が無言で無効化される**
(設定画面は正常に見えるが adkill.js が注入されなくなる)。
- conf 更新のたびに https://example.com のバッジテストを行うようユーザーに案内する
- バッジが出なければ (i) → HTTPS復号 → 証明書 → 新しいCA証明書を生成 → インストール →
  **iOS 設定 → 一般 → 情報 → 証明書信頼設定 で新しい証明書のトグルを ON**(2026-09-09 の実障害。
  プロファイルのインストールと信頼設定 ON は別操作で、後者を忘れると SR はエラーも出さず復号を
  スキップし「TCP Stream / FINAL,DIRECT」の素通しになる)
- 証明書モジュール(ca-p12 退避)は、証明書のインストールと信頼が完了した後に入れること。
  完了前に入れると競合して復号が動かない(公式手引の既知事項)
- **ca-p12 を公開リポジトリの conf に書いてはならない**(秘密鍵の公開 = 通信の復号を第三者に許す)
- 診断用: adkill.js は example.com / neverssl.com 等で右下に「adkill ✓」バッジを表示する

## 現在の状態と未解決事項 (2026-09-09 引き継ぎ時点)

**動作確認済み**: 3層すべて稼働。MITM+注入は example.com のバッジテストで検証可能。
X(Twitter)アプリはピンニングのため adkill_mitm.sgmodule で MITM 除外済み(アプリ内広告は対象外)。

**未解決 (最優先)**: newsdig.tbs.co.jp の Admiral 壁
- newsdig は ECH のため MITM 不可 → adkill_mitm.sgmodule で除外中 → 注入不可
- 壁の配信元 content-loader.com / error-report.com を adkill_custom.list でブロック済み(効果は未確認)
- まだ壁が出る場合の次の一手: iOS の AdGuard DNS 構成プロファイル 2 つを削除
  (設定→一般→VPNとデバイス管理)。ECH 鍵は このプロファイル経由の DNS HTTPS レコードで
  配布されている可能性が高く、削除すれば ECH 不成立 → MITM 復活 → モジュールから
  -newsdig.tbs.co.jp を外し、adkill.js の LITE_HOSTS からも newsdig を外して JS 注入で壁を掃除
- Admiral はドメインを変える(html-load.com → content-loader.com を実測)。
  壁再発時はログの DIRECT 行から新ドメインを特定して adkill_custom.list に追加

**adkill.js の LITE_HOSTS**: CSS のみ注入(JS なし)のライトモード。SPA と注入の相性が悪い
サイト向け。現在 newsdig が入っている(MITM 除外中なので実質未使用)。

**GitHub トークン**: ユーザーは作業ごとに1日有効の fine-grained token (Contents RW, adkill のみ)を
発行する運用。作業完了時に削除を促すこと。

## 既知の限界
- YouTube アプリ / googlevideo、Google アプリの Discover 広告は証明書ピンニングで対象外
- adkill.js は CSP ヘッダを剥がすため、金融・決済系は MITM 除外を維持する
