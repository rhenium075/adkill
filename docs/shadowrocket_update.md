# Shadowrocket の更新・復旧ガイド

本運用の現行手順。過去の操作記録は [履歴資料](history/shadowrocket-update-before-review2.md) に保存しており、更新手順として使用しない。

## 通常の更新

`adkill_custom.list` / `adkill_jp.list` だけの変更は、接続を OFF/ON してルールの再取得を確認する。取得・キャッシュ状態によって反映されない場合は、Shadowrocket の取得状況とテストルールで対象ドメインを確認する。conf 本体は再取得しない。

`adkill.js` / `adshield_stub.js` の変更は、保守側で実装コミットを作り、pin_release.py で module の全5参照をその完全 SHA に更新する必要がある。接続 OFF/ON だけでは固定参照が新しいコードに変わらない。PR のクロスレビューと CI 成功、ユーザーによるマージ判断を経て反映する。

module を反映する前に、現在の `adkill_mitm.sgmodule` 全体を復元可能な形で保持する。Shadowrocket のコンフィグからモジュール `adkill MITM除外` を選んで更新し、接続を OFF/ON する。この表示名は互換性のため維持しているが、モジュールは除外だけでなく復号対象、本文処理、リライトも管理する。

更新後は module の script-path / リライト先 SHA が採用した PR と一致するか確認する。`https://example.com/` のバッジは注入の生存確認であり、版の一致や他のアプリの正常動作まで示さない。バッジが出ない場合は許可対象、スクリプトの取得、HTML 応答、キャッシュ、CA の存在・信頼状態の順に確認する。

## 表示・通信の確認

採用した module の版、Shadowrocket/iOS の版と確認 URL を記録する。Claude・LINE・決済アプリの疎通、trafficnews のトップ・記事・次ページ、newsdig の壁と CSS、livedoor の平文 HTTP を変更の影響範囲に合わせて確認する。TLS・ストリーミング・実機メモリの挙動はブラウザ E2E では代用できない。

`/special/` 系はユーザーから実機で壁が出ないと報告されたため、今回 bodyPattern は拡大しない。`/publicity/` を含む個別 URL・端末版の証跡はこのリポジトリにない。SDK タグの存在だけでは注入対象を追加する理由にしない。

## 不調時の復旧

前版の module 全体を復元し、接続を OFF/ON して復旧を確認する。旧 SHA を pin_release.py に渡す操作は実行コードしか戻さず、本文 pattern・hostname・リライト条件を戻せないため、通常のロールバック手順にはしない。custom/jp/外部ルールの可変参照や DNS 側の変更も、module の復元では戻らない。

注入だけが原因なら、本文対象の縮小や SKIP_HOSTS の変更をレビューする。ただし SKIP_HOSTS は本文バッファリングの開始後に実行されるので、requires-body 自体の障害への対処には本文 pattern の縮小が必要。TLS 復号自体が原因なら MITM 許可を見直す。

現在の検証は正負パターンの競合を拒否する。例えば trafficnews.jp を外す場合、module の正の trafficnews.jp を取り除き、本文ポリシーと pattern の該当部分も同時に見直す。正の許可を残したまま `-trafficnews.jp` を足す方法は使わない。conf 側の正の許可やワイルドカードが対象を含む場合、module だけの非競合変更では除外できない。緊急時は接続を OFF にして通信を確認し、CA を保持する端末ローカル設定の変更として扱う。検証を外して負の項目を追加する運用にはしない。

## conf と CA を扱う場合

conf 本体のリモート再取得は、端末で追記された ca-p12 / ca-passphrase を失う可能性がある。通常の広告ルール更新には不要。conf を変更する必要がある場合に限り、端末内の安全な場所へ設定を退避し、CA の保持を確認してから変更する。秘密鍵を GitHub、共有ログ、PR に貼り付けない。

復号できない場合は、まずバッジ確認の切り分けを行う。CA の欠落・不整合が確認された場合のみ、Shadowrocket の HTTPS 復号設定で証明書を生成・インストールし、iOS の「一般／情報／証明書信頼設定」で信頼を有効にする。証明書モジュールを使っている場合は、その参照先との整合性も確認する。接続 OFF/ON 後に疎通を再確認する。

## AdGuard DNS 側

`adguard_dns_userrules.txt` はファイルを更新するだけではダッシュボードへ反映されない。ユーザールールを保存するか、登録済みカスタムリストの再取得を確認する。

このリポジトリの conf に設定した DoH は Shadowrocket 接続中の設定であり、それだけで接続 OFF 時の DNS 保護が継続するわけではない。OFF 時の保護には別途 OS 側の DNS 設定等が必要で、その有無は端末で確認する。同一 AdGuard エンドポイントを primary/fallback に指定しているため、障害から独立した退避経路でもない。
