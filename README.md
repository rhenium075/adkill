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
┌─ 1. DNS 層 ──────────── AdGuard DNS (DoH)。SR オフ時の保険
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
- **更新経路の固定** — 実行コード (adkill.js / adshield_stub.js) は検証済みコミットの
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
npm run test:all   # + 実ブラウザ E2E (要 Playwright)
node sr_emulator.js "https://example.com/" --dns   # 実サイトを SR 相当の条件で描画検証
```

## ライセンス

リポジトリ全体を **GPL-3.0-or-later** で公開します ([LICENSE](LICENSE))。

- `adkill_jp.list` は [AdguardTeam/AdguardFilters](https://github.com/AdguardTeam/AdguardFilters)
  (JapaneseFilter, GPLv3) の派生物です。ヘッダの帰属表示を保持してください
- ルールは [blackmatrix7/ios_rule_script](https://github.com/blackmatrix7/ios_rule_script) と
  [ACL4SSR](https://github.com/ACL4SSR/ACL4SSR) の RULE-SET を参照します (各リポジトリのライセンスに従う)
- アンチアドブロック対策の知見の一部は [uBlockOrigin/uAssets](https://github.com/uBlockOrigin/uAssets)
  (GPLv3) のフィルタを参考にしています

## 免責

本プロジェクトは広告・トラッキングの遮断による私的な閲覧環境の改善を目的とします。
偽の広告インプレッションを送信する機能 (アドフラウド) は含みませんし、追加しません。
各サイトの利用規約・お住まいの地域の法令はご自身で確認してください。
