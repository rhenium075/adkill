# ライセンスと第三者由来部分

## 適用範囲

本プロジェクトの自作部分（コード・設定・文書）は GPL-3.0-or-later で公開する。ライセンス本文は [LICENSE](LICENSE)。第三者由来部分にはその権利者の条件が適用され、本プロジェクトの宣言によって条件を上書きしない。GPL 本文の末尾にある適用例だけを根拠に、第三者が「以降の版も可」を選択したと推定しない。

確認日：2026-09-11。以下は公開情報とリポジトリ内の記録に基づく台帳であり、未確認の採用元を推測して補ったものではない。既存の許諾を撤回・変更するものでもない。

## 同梱している派生物・移植部分

`adkill_jp.list` は [AdguardTeam/AdguardFilters](https://github.com/AdguardTeam/AdguardFilters) の JapaneseFilter を DOMAIN-SUFFIX 形式へ変換した派生物。採用元の GPLv3 が適用される。[上流の LICENSE](https://github.com/AdguardTeam/AdguardFilters/blob/master/LICENSE) と本リポジトリの LICENSE で本文を参照できる。ライセンス本文中の Free Software Foundation の著作権表示は、フィルタ自体の権利者表示ではない。

既存配布物の記録は生成日 2026-09-10 と変換器名だけで、採用した上流コミットは不明。対象セクションは変換器上では `adservers.txt`、`adservers_firstparty.txt`、`antiadblock.txt` だが、既存生成物とその入力の完全一致は再現確認できていない。今回の変更は通知の追記だけで、配布ルールは再生成していない。上流の通知と版選択条件の履歴照合は未完了であり、派生部分を一律に GPL-3.0-or-later と再許諾したとは扱わない。

今後の生成では `tools/convert_jp_filter.py --source-ref <上流の完全SHA> -o adkill_jp.list` を使用する。同じ固定コミットから全セクションを取得し、生成物に入力 URL、コミット、上流 LICENSE への固定リンク、変換内容を記録する。出典コメントは保持する。ライセンスや通知を含む入力の変更も、採用時に確認する。

`adkill.js` の Ad-Shield 復元広告を隠す CSS（`iframe[id][height^="  "]`、空白始まりの寸法属性、`--gn-ov-ad-height`）は、既存コードが [uBlockOrigin/uAssets](https://github.com/uBlockOrigin/uAssets) のルール移植と記録している部分。[上流 LICENSE](https://github.com/uBlockOrigin/uAssets/blob/master/LICENSE) は GPLv3。採用元の正確なファイル・コミットと改変前の通知は未記録で、今回のレビューでは確定できていない。単に着想を参考にしただけと説明せず、移植部分として明示する。ここにも上流の条件が適用される。移植範囲の説明は既存コメントに基づき、他の部分に転載が一切ないと保証するものではない。

`adshield_stub.js` と `tools/tests/fixtures/adshield_recovery_sim.js` は、既存の実測記録に基づくゲートフラグ・復旧動作の再実装。リポジトリには実物の難読化コードを含めないという記録があるが、独立チームによるクリーンルーム手続きの証跡はない。その開発方式や包括的な権利処理を保証する表現は用いない。

## 実行時に URL で参照するルール

[blackmatrix7/ios_rule_script](https://github.com/blackmatrix7/ios_rule_script) の Advertising RULE-SET は外部 URL 参照。[上流 LICENSE](https://github.com/blackmatrix7/ios_rule_script/blob/master/LICENSE) は GPL v2 本文で、ここでは以降の版の選択可否を確定しない。

[ACL4SSR/ACL4SSR](https://github.com/ACL4SSR/ACL4SSR) の BanAD / BanProgramAD RULE-SET も外部 URL 参照。[上流 LICENCE](https://github.com/ACL4SSR/ACL4SSR/blob/master/LICENCE) は CC BY-SA 4.0。プロジェクト全体の GPL 宣言でこれらの条件は変わらない。将来、取得したファイルを同梱・改変配布する場合は帰属、ライセンス、改変表示、継承条件を個別に確認する。現行の可変 URL は採用内容の不変性を保証しない。

## テスト時に取得する依存物

ブラウザ E2E は [FuckAdBlock 3.2.1](https://github.com/sitexw/FuckAdBlock/blob/41af4faebc219b44f84c682b24b57ad1e413b3cb/fuckadblock.js)（Copyright 2015 Valentin Allaire、MIT）と [IAB AdBlockDetection](https://github.com/InteractiveAdvertisingBureau/AdBlockDetection/blob/e001ef8754082dd07341064e16fa50e5c7985603/adblockDetector.js)（Copyright 2017 IAB、BSD-3-Clause）を固定コミットから取得する。取得したファイルの既存ヘッダは削除しない。これらはテスト用キャッシュで、本番配布コードへの組み込みではない。キャッシュ等を別途配布する場合は各ライセンス本文と通知も付随させる。

jsdom と推移的 npm 依存は `tools/tests/package-lock.json`、Playwright は CI の固定バージョンで管理する。依存パッケージのライセンスは各配布パッケージのものが適用される。lockfile はライセンス本文の代替ではない。node_modules やブラウザ実行物を本リポジトリには同梱しない。

## 単体ファイルの取得・再配布

本番ファイルは raw URL / CDN から個別取得されるため、各ファイルのコメントに適用範囲、ライセンス本文、この通知への案内を置く。プロジェクトの配布物をまとめて再配布する際は LICENSE と本ファイルも同梱し、第三者の通知・変更表示を保持する。コメントのリンクだけで、すべての配布形態の義務が自動的に満たされると解釈しない。

本プロジェクトは無保証。リンクや自作部分のライセンス宣言は、第三者の商標・特許・サイト利用条件など別の権利について許諾を与えるものではない。
