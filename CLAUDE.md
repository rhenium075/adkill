# adkill の保守方針

本運用は iPhone + Shadowrocket。Surge/Loon/Quantumult X 用ファイルは未保守・実機未検証の参考資料であり、本運用の安全条件や更新手順を流用できるとは扱わない。

## 現行の安全条件

MITM の許可と本文処理の許可を分離する。`tools/mitm_policy.json` と conf/module の設定を `tools/validate_config.js` で照合する。本文処理は診断ホストのルートと trafficnews.jp の公開トップ・数値記事・カテゴリだけ。未知のパスやサブドメインを自動追加しない。`/special/` 系はユーザーから壁なしの実機確認が報告されており、本変更では `/special/`・`/publicity/` を追加しない。個々の確認 URL・端末バージョンは記録されていないため、サイト全体の保証にはしない。

conf の `[Script]` は空、module は審査した adkill 定義一つだけ。別名の定義、重複セクション、未審査のオプションを追加しない。4KB/200項目は保守的な hostname 運用上限であり、Shadowrocket の解析限界を測定した値ではない。ポリシー自体の変更もレビューする。

壁候補の除去は名前と文言の両方を要求し、要素自身と子孫のフォーム・編集領域・操作部品、本文を保護する。壁候補を CSS だけで非表示にしない。広告スロット用 CSS は別の限定セレクタである。iframe の壁はホスト境界と `/modal` パスで判断する。ページ本来の setTimeout と施行 CSP を保持する。

MITM 許可リストは無障害の保証ではない。DNS、外部ルール、UDP/443 全体遮断、CDN 転送への依存は残る。障害の根本原因が未確定の箇所を、推測で確定扱いしない。

## 変更とリリース

ルールの追加は `adkill_custom.list` と `adguard_dns_userrules.txt` を対で変更する。conf の再取得を日常更新として案内しない。MITM・本文・リライトの変更は module とポリシーを照合する。サイト審査ツールの PASS は取得した一応答の観測であり、ホスト全体の許可ではない。

作業ブランチで実装を変更し、`cd tools/tests && npm ci && npm test` を実行する。実装コミットを作ってから `python3 tools/pin_release.py <実装コミットの完全SHA>` を実行する。続けて `npm run test:release` と `npm run test:all` を実行し、参照更新を別コミットにする。Git 履歴と Playwright/Chromium が必要。詳細は [テストガイド](tools/tests/README.md)。

`test:release` は実行コード全5参照について同一コミット・ファイルの実在・作業ツリーとのバイト一致を検査する。通常テストとブラウザ E2E は作業ツリーのコードを検証する。この二つを合わせて配布コードの取り違えを防ぐが、CDN 到達性や Shadowrocket 実機挙動を保証するものではない。

PR に変更理由、検証結果、未検証の条件、ロールバック対象を記載する。クロスレビューと CI 成功後、ユーザーがマージと端末反映を判断する。マージ前に main を直接更新しない。

## 更新・復旧

端末操作は [更新・復旧ガイド](docs/shadowrocket_update.md) を唯一の現行手順とする。通常は module 更新と接続 OFF/ON。conf 再取得はローカル CA を失う可能性があるため通常手順に含めない。バッジだけでリリース版を判定しない。

不調時は前版の module 全体を復元する。SHA だけを戻しても hostname・pattern・リライトは戻らない。正負の MITM パターンを重複追加する操作は検証で拒否される。対応方法と、conf 側の許可が原因の場合の限界は更新ガイドを参照。

## JP リストとライセンス

`python3 tools/convert_jp_filter.py --source-ref <上流の完全SHA> -o adkill_jp.list` で再生成する。変換器は全入力を同一の固定コミットから取得し、入力 URL とライセンス参照を出力に残す。失敗・未対応の例外・件数不足では既存リストを置き換えない。配布中のリストの再生成は全層の競合確認を伴う別作業とし、過去の入力 SHA を推測して補わない。

ライセンスの適用範囲と第三者由来部分は [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を参照する。通知・出典を消さず、第三者の許諾を一括したプロジェクト宣言で上書きしない。実測仕様からの再実装を、独立したクリーンルーム開発と断定しない。

## 記録の扱い

インシデントの観測と仮説は [インシデントレポート](docs/incident-2026-09-10.md)、前回修正の範囲は [安全性修正記録](docs/adversarial-hardening.md) に記載する。旧保守記述は [履歴資料](docs/history/maintenance-before-review2.md) に隔離した。履歴の操作指示は再利用しない。共有ログから認証情報・個人情報・不要なクエリを取り除き、ca-p12 やパスフレーズを公開しない。
