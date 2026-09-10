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

**newsdig.tbs.co.jp の壁 — 2026-09-09 解析完了 (対策実装済み・実機確認待ち)**
※ ベンダーは当初 Admiral と記載していたが、uAssets の帰属情報と loader.min.js /
error-report.com シグネチャから **Ad-Shield (ad-shield.io)** と確定。以下の「Admiral」旧記述は
すべて Ad-Shield のこと。
- **ECH 診断は誤りだった可能性が濃厚**: newsdig には HTTPS(type65) DNS レコードが存在せず
  (Google/Cloudflare/AdGuard 全リゾルバで実測)、ホスティングも IIJ 直 (Cloudflare でない)。
  ブラウザは HTTPS RR の ech= が無ければ ECH を試みない → MITM 不可の真因は
  当時の「CA 信頼設定忘れ」障害と同時期だったための誤診とみられる。
  **AdGuard DNS プロファイル削除案は根拠喪失** (削除不要)
- **壁の全メカニズム (実物を難読化解除して確認)**: HTML 内インラインの「復旧スクリプト」が
  loader.min.js の実行成功フラグ `window["as_"+hashCode("loader-check_"+UTC日ms)]` を確認 →
  無ければ html-load.com / fb.html-load.com / content-loader.com / fb.content-loader.com を順に試行 →
  全滅で error-report.com へ報告 POST + **ページの link/style を全削除** + 全画面 iframe 壁
  (report.error-report.com/modal, z-index 2147483647) + **3秒以内に iframe から postMessage が
  無ければ confirm() ダイアログ → reload ループ**。TINYGIF は iframe に「正常に」GIF を返すため
  postMessage が来ず、ドメイン遮断だけでは confirm ループ+CSS破壊が必ず発生する
- **対策 (adkill.js A2 セクション、疑似環境で実物スクリプトに対し検証済み)**:
  注入 JS が同じ hashCode でゲートフラグを先に立て、復旧スクリプトを丸ごと不発化。
  保険として sweep が壁 iframe (error-report.com src / z-index≒最大の全画面 fixed) を除去
- **2026-09-10 実機テスト結果**: 除外を解除して MITM を試したところ「接続不可」を再現
  → **除外に復帰** (到達性優先)。ECH でも TLS 特性でもない (HTTPS RR なし・TLS ごく普通・
  クライアント証明書要求なしを実測)。エミュレータ (tools/tests/sr_emulator.js) では
  MITM+注入で壁なしの完全動作を確認済みのため、SR の MITM が newsdig でだけ失敗する
  真因は端末側。**切り分け待ち: 除外を外した状態での SR ログのエラー行**。
  ca-p12/信頼設定が原因なら CA 再生成で解決するはず (docs/shadowrocket_update.md 参照)
- Admiral はドメインを変える。壁再発時はログの DIRECT 行から新ドメインを特定して
  adkill_custom.list + adguard_dns_userrules.txt に追加

**adkill.js の LITE_HOSTS**: CSS のみ注入(JS なし)のライトモード。SPA と注入の相性が悪い
サイト向けの機構として維持。newsdig は Admiral 対策に JS 注入が必須のため 2026-09-09 に除外し、
現在は空。

**他サイトの実測 (2026-09-09)**: toyokeizai=Piano/npttech 方式(bait の onerror でのみ検知 →
npttech.com を TINYGIF 化して対応)、rocketnews24=Funding Choices(googlefc スタブで対応済み)、
gigazine=非ブロッキングの寄付バナーのみ(壁ではない・対応不要)、dailycaller(米)=Admiral SDK を
HTML 直埋め(ドメイン遮断不能な形態も存在する実例)。

**jetstream.blog の表示崩れ (2026-09-10 解決)**: 実機スクリーンショットで正体は
**画像の全滅** (同一オリジンのロゴまで壊れ画像アイコン) と判明。原因は conf の
`[Script] pattern=^https?://.+` + requires-body が**全バイナリ応答を SR にバッファリング
させていた**こと (SR のバイナリ body 処理の弱点で画像が壊れる。エミュレータは document
のみ変換していたため再現しなかった — 以後 sr_emulator は conf の pattern を読んで同じ
条件で動く)。**pattern を「文書らしい URL」(ホストのみ/末尾スラッシュ/拡張子なし/
.html .php 等) に限定**して解決。この修正は conf 編集が必要な例外ケース
(ユーザーに C 手順 = conf 更新 + CA 再生成を案内済み)。
併せて Content-Encoding ヘッダ削除・U+FFFD 誤デコードガード・"ad-block" 部分一致 CSS の
撤去 (head-block 等への潜在誤爆)・byName の境界付き正規表現化・#adkill ハッシュでの
バッジ診断機能を実施。

## アンチアドブロック対応状況 (2026-09-09 時点)

| 方式 | 対応 | 検証 |
|---|---|---|
| FuckAdBlock / BlockAdBlock | abort-on-read + bait 温存 | 実物ライブラリで E2E 済み |
| IAB AdBlockDetection | 同上 | 実物ライブラリで E2E 済み |
| Funding Choices | googlefc スタブ + fc-ab CSS + TINYGIF | スタブ単体テスト + rocketnews24 実測 |
| Ad-Shield (newsdig 等) | ゲートフラグ先行設定 (A2) + 壁 iframe sweep + 全配信ドメイン TINYGIF + 第一者ローダー URL-REGEX + 復元広告 CSS | 実物復旧スクリプトで再現・不発化を確認 |
| Admiral | ドメイン遮断 + 汎用 sweep。HTML 直埋め形態は sweep のみ | dailycaller で形態確認のみ |
| AdDefend / Blockthrough | ドメイン遮断 (addefend.com / btloader.com 等) | 現行導入サイトでの動的活性を未観測 |
| Piano (npttech) | bait を TINYGIF で偽装成功させ検知不発化 | toyokeizai の実コードで機構確認 |

**既知の限界 (対応しない/できないもの)**:
- **サーバーサイド検知**: 広告リクエスト不在をサーバー側で推定する方式は、偽ビーコンを
  送らない限り原理的に回避不能。**偽インプレッション送信はアドフラウド(不正行為)になるため
  実装しない**
- **Level 4/5 (レスポンス内の広告オブジェクト混在)**: JSON 応答の書き換えはサイト個別の
  分類器が必要で汎用化できない。必要になったらサイト個別に [Script] を足す方針
- Ad-Shield が SDK ごと第一者インライン化した場合はドメイン遮断が効かない。
  その場合も A2 ゲートフラグと sweep が最後の防衛線

**GitHub トークン**: ユーザーは作業ごとに1日有効の fine-grained token (Contents RW, adkill のみ)を
発行する運用。作業完了時に削除を促すこと。

## 既知の限界
- YouTube アプリ / googlevideo、Google アプリの Discover 広告は証明書ピンニングで対象外
- adkill.js は CSP ヘッダを剥がすため、金融・決済系は MITM 除外を維持する
