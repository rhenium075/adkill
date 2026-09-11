# adkill

iPhone (iOS 26) + [Shadowrocket](https://apps.apple.com/app/shadowrocket/id932747118) で、
Chrome / アプリ内 WebView を含む端末全体の Web 広告と「広告ブロッカーを無効にしてください」
表示（アンチアドブロック壁）を除去する、**個人用**の設定・スクリプト一式。

> **注意**: これは作者個人の端末のための構成であり、汎用プロダクトではありません。
> MITM (HTTPS 復号) を含むため、仕組みを理解した上で**自分が所有する端末の自分の通信**に
> のみ使用してください。CA 秘密鍵 (ca-p12) の扱いを誤ると通信の安全性を損ないます。
> 利用は自己責任です。

## 仕組み（3層構成）

```
┌─ 1. DNS 層 ──────────── AdGuard DNS (DoH)。SR 接続中の名前解決
├─ 2. ルール層 ──────────  Shadowrocket ルール。広告ドメインを
│                          REJECT-TINYGIF (200 + 1x1 GIF) で「成功したふり」に偽装
└─ 3. MITM + 注入層 ─────  許可リストのホストのみ復号し、adkill.js を HTML に注入。
                           広告 SDK のスタブ化・検知ライブラリの abort・壁の除去
```

設計原則（詳細は [CLAUDE.md](CLAUDE.md)）:

- **遮断ではなく偽装** — 切断は検知されるため、広告リクエストには 200 + 1×1 GIF を返す
- **MITM は許可リスト方式** — 復号するのは偽装が必要な広告ドメインと壁対策サイトのみ。
  一般サイト・アプリ・API は復号しない
- **おとり要素は隠さない** — `.ad` 等の汎用クラスを CSS で隠すと検知される
- **Shadowrocket 本運用のコード参照固定** — 実行コード (adkill.js / adshield_stub.js) は検証済みコミットの
  完全 SHA を参照。main の自動追従はしない

## 構成ファイル

| ファイル | 役割 |
|---|---|
| `adkill.conf` | Shadowrocket 本体設定 (DNS / ルール / MITM 許可リスト)。端末で CA 鍵が追記されるため原則リモート更新しない |
| `adkill_mitm.sgmodule` | モジュール: MITM 対象の増減・[Script] (SHA 固定)・[URL Rewrite] (Ad-Shield スタブ差し替え)。**日常の更新はここ** |
| `adkill.js` | 注入スクリプト: adsbygoogle/googletag/googlefc スタブ、検知 abort、壁 iframe/オーバーレイ除去、空広告枠の折り畳み |
| `adshield_stub.js` | Ad-Shield loader.min.js の代替スタブ (実行成功フラグを立てて復旧スクリプトを不発化) |
| `adkill_custom.list` | 独自の広告ドメイン・URL-REGEX ルール (日常の追加はここ) |
| `adkill_jp.list` | AdGuard Japanese Filter から変換した RULE-SET (自動生成) |
| `adguard_dns_userrules.txt` | AdGuard DNS 側のカスタムルール (custom.list と対で保守) |
| `tools/convert_jp_filter.py` | JP フィルタ変換器 |
| `tools/pin_release.py` | 実行コード参照の SHA 固定ツール |
| `tools/tests/` | 疑似環境テスト (Shadowrocket モック / jsdom / 実ブラウザ E2E / SR エミュレータ) |
| `docs/shadowrocket_update.md` | 端末側の更新・診断手順 |

## 安全性修正と実機確認

[安全性修正の範囲と適用条件](docs/adversarial-hardening.md) を参照。MITM の許可は
本文改変の許可とは別です。許可リストは影響を限定しますが、DNS・外部ルール・UDP/443
遮断を含む端末全体の無障害を保証しません。

## テスト

```bash
cd tools/tests
npm ci
npm test           # jsdom 系 + ルール検証
npm run test:release # 全5参照の実在・同一コミット・配布コードとの一致
npm run test:all   # + 実ブラウザ E2E (要 Playwright。導入は tools/tests/README.md)
node sr_emulator.js "https://example.com/" --dns   # 実サイトを SR 相当の条件で描画検証
```

ブラウザ E2E は合成ページ上のコード動作を確認します。配布参照は `test:release`、
実サイトの転送はエミュレータ、TLS・バッファリング等は実機確認が必要です。
再レビューの対応範囲は [修正記録](docs/review-followup.md) に記載しています。

## ライセンス

自作部分（コード・設定・文書）は **GPL-3.0-or-later**。本文は [LICENSE](LICENSE)。
第三者由来部分には上流の条件が適用されます。`adkill_jp.list` の派生元、`adkill.js` の
uAssets 移植部分、外部 RULE-SET、テスト用依存物の区別と通知は
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を参照してください。

既存の JP リストと uAssets 移植部分は採用コミットが未記録です。その点を含めて
確認できた範囲を記載しており、出典・版選択条件の歴史的な照合が完了したとは扱いません。
今後の JP 変換は上流の完全 SHA を指定し、生成物へ出典を記録します。
単体ファイルを再配布する場合も、適用ライセンス・出典・変更表示を保持してください。

## 免責

本プロジェクトは広告・トラッキングの遮断による私的な閲覧環境の改善を目的とします。
偽の広告インプレッションを送信する機能 (アドフラウド) は含みませんし、追加しません。
各サイトの利用規約・お住まいの地域の法令はご自身で確認してください。
