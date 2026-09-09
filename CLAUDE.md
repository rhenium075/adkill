# adkill — iOS 端末内完結の広告・アンチアドブロック除去

iPhone 17 (iOS 26) + Shadowrocket で、Chrome / Google アプリ含む全アプリの
Web 広告と「広告ブロッカーを無効にしてください」表示を除去するプロジェクト。

## 構成ファイル

| ファイル | 役割 |
|---|---|
| `adkill.conf` | Shadowrocket 用フルコンフィグ。**メインの成果物**。DNS(AdGuard DoH)・広告ドメインの REJECT-TINYGIF ルール・RULE-SET 参照・全 HTML への adkill.js 注入・MITM 除外リストを含む |
| `adkill.js` | 全 text/html 応答に注入されるスクリプト。adsbygoogle/googletag/googlefc のスタブ化、検知ライブラリの abort、アンチアドブロックオーバーレイの除去とスクロール復帰、CSP 除去とセットで動く |
| `adkill_jp.list` | AdGuard Japanese Filter から変換した DOMAIN-SUFFIX の RULE-SET（自動生成。**手で編集しない**） |
| `tools/convert_jp_filter.py` | 上記の生成スクリプト。`python3 tools/convert_jp_filter.py > adkill_jp.list` で再生成 |
| `adguard_dns_userrules.txt` | AdGuard DNS（プライベートサーバー）のカスタムブロックリスト。conf と対 |
| `adkill.sgmodule` / `adkill_quantumultx.conf` | Surge/Loon 用モジュールと Quantumult X 用断片（現在は未使用の代替） |

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
2. `adkill.conf` の該当セクション（日本のアドネットワーク等）に `DOMAIN-SUFFIX,<domain>,REJECT-TINYGIF` を追加
3. `adguard_dns_userrules.txt` にも `||<domain>^` を追加（2ファイルは対で保守）
4. commit & push → ユーザーに「コンフィグ更新 → 接続 OFF/ON → テストルールで確認」を案内

### JP リストの更新
`python3 tools/convert_jp_filter.py > adkill_jp.list` → commit。
出典は AdguardTeam/AdguardFilters (GPLv3)。ヘッダの帰属表示を消さないこと。

### サイトが壊れたとき
- SSL エラー → conf `[MITM] hostname` に `-そのドメイン` を追加
- 表示崩れ/ログイン不可 → `adkill.js` 冒頭の `SKIP_HOSTS` にホスト追加（軽い方から試す）

## デバイス側の反映手順（ユーザーに案内する定型文）
1. Shadowrocket: コンフィグタブ → adkill.conf を左スワイプ → 更新（無ければ 設定 → 更新 → コンフィグ）
2. ホームタブ: 接続 OFF → ON
3. コンフィグ → テストルール で対象ドメインが REJECT-TINYGIF になるか確認

## 既知の限界
- YouTube アプリ / googlevideo、Google アプリの Discover 広告は証明書ピンニングで対象外
- adkill.js は CSP ヘッダを剥がすため、金融・決済系は MITM 除外を維持する
