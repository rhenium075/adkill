# Shadowrocket 更新手順ガイド

adkill の変更を iPhone に反映するための実際の操作手順。
「何を変更したか」によって必要な操作が違うので、まず下の表で確認する。

## 今回 (2026-09-10 第6報) の反映手順 — ⚠️ conf 更新 (最後の1回) + モジュール更新

外部レビューの残件修正に加え、**更新経路を固定**した:
- adkill.js / adshield_stub.js の参照を「検証済みコミットの完全 SHA」に固定
  (main の自動追従を廃止。誤 push・侵害コードが端末へ自動流入する経路を閉じる)
- [Script] 定義を conf からモジュールへ移動。**今後コード更新で conf を触る必要がなくなる**
  (今回の conf 更新が、この移行のための最後の 1 回)

手順:
1. コンフィグタブ → adkill.conf を左スワイプ → **更新** ([Script] が conf から消える)
2. **モジュール更新** (adkill MITM除外 → 左スワイプ → 更新。SHA 固定の [Script] が入る)
3. 接続 OFF → ON → `https://example.com` でバッジ確認
4. バッジが出ない場合: トラブルシューティング早見の段階的確認 → 必要なら C の CA 再生成
5. 確認: trafficnews.jp / newsdig / jetstream / livedoor が正常なこと

**今後のコード更新の流れ (「最新を取得」から「この版を採用」へ)**:
1. main で修正・テスト → コミット SHA を確定
2. `python tools/pin_release.py <SHA>` でモジュール内の参照を書き換え → commit & push
3. ユーザーは変更内容を確認してから**モジュール更新** = その版を明示的に採用
4. 不調ならモジュールの SHA を旧版に戻して再度モジュール更新 (ロールバック)

補足: これは参照先の固定であり本文の暗号学的検証ではない (GitHub/jsDelivr/TLS への信頼は残る)。
さらに固めるなら GitHub の Immutable Releases を有効化し、リリースアセットとして配布した
モジュール URL に切り替える (リポジトリ Settings → General → Releases → Immutable releases)。

## (旧) 2026-09-10 第5報の反映手順 — 実施済み

trafficnews.jp 等で広告と白画面が出た件。原因は Ad-Shield の **sdk.js 型**
(newsdig の loader.min.js とは別系統で、`<script data-sdk onload="難読化アンチタンパー">` +
独立した難読化復旧スクリプトの2段構成)。ドメイン遮断だと復旧スクリプトが壁を出す。

対策: trafficnews は keep-alive なので MITM 可能。**MITM 許可リストに trafficnews.jp を追加**し、
adkill.js が sdk.js の script タグ(onload 込み)と復旧スクリプトを HTML から除去する
(uBlock と同じ方式)。広告配信元 (taxel/im-apps/rise.enhance) も遮断に追加。

手順:
1. **モジュール更新** (コンフィグ → モジュール → adkill MITM除外 → 左スワイプ → 更新)
2. 接続 OFF → ON (custom.list の追加ドメインも自動で入る)
3. adkill.js は最大1時間で自動更新。急ぐなら一度接続 OFF→ON し、
   trafficnews を Chrome のキャッシュ削除後に開き直す
4. 確認: trafficnews.jp が広告なし・白画面なしで読める

**新しい壁サイトを見つけたときの一般手順**:
- `Connection: close` を明示するサイト (newsdig/livedoor/FNN で実測) は MITM で応答死の
  実績があるため MITM に入れない → 壁の loader/sdk 配信ドメインを [URL Rewrite] で
  スタブ差し替え (newsdig 方式)
- close の明示がなければ `adkill_mitm.sgmodule` の %APPEND% に正の項目で**サイトを追加**して
  試す (adkill.js の除去ロジックが効く)。
  ※ ヘッダは目安にすぎない: HTTP/1.1 は keep-alive ヘッダなしでも持続接続になり得るし、
  HTTP/2 には Connection ヘッダ自体が無い。HEAD と実際の GET、curl と実機で応答が違うことも
  ある。追加後に実機でそのサイトの表示・SR ログを必ず確認し、応答死 (同一 URL への連続
  リトライ) が出たら除外へ戻すこと

---

## 早見表: 変更内容ごとに必要な端末操作

| リポジトリで変更したファイル | 端末で必要な操作 | 反映タイミング |
|---|---|---|
| `adkill_custom.list` / `adkill_jp.list` | **接続 OFF→ON のみ** | 接続時に自動再取得 |
| `adkill.js` / `adshield_stub.js` | **pin_release.py で SHA 更新 → モジュール更新** (自動追従しない) | モジュール更新時のみ |
| `adkill_mitm.sgmodule` | **モジュールの手動更新**(下記 B) | 手動更新時のみ |
| `adkill.conf` | **conf の手動更新(下記 C。CA 消失リスクあり・要バッジ確認)** | 手動更新時のみ |
| `adguard_dns_userrules.txt` | AdGuard DNS ダッシュボードでの反映(下記 D)。端末操作なし | ダッシュボード保存後 |

> 原則: **conf は触らない**。日常のルール追加・削除が custom.list で行われるのは、
> conf の再取得で MITM 用 CA 秘密鍵 (ca-p12) が消えて復号が無言で止まるため。

---

## A. 日常の更新 (custom.list / jp.list / adkill.js の変更後)

1. Shadowrocket を開く → ホームタブ → **接続 OFF → ON**
2. 確認: コンフィグタブ → 対象 conf の **テストルール** で
   追加したドメイン (例: `css-load.com`) が `REJECT-TINYGIF` になること

これだけ。RULE-SET とスクリプトは GitHub の raw URL から自動取得される。

## B. モジュール (MITM 除外リスト) の更新

`adkill_mitm.sgmodule` を変更したとき (例: newsdig の MITM 除外解除):

1. コンフィグタブ → **モジュール** → `adkill MITM除外` を探す
2. モジュールを**左スワイプ → 更新** (無ければ一度削除して URL から再追加:
   `https://raw.githubusercontent.com/rhenium075/adkill/main/adkill_mitm.sgmodule`)
3. ホームタブ → 接続 OFF → ON
4. 確認: `https://example.com` を開いて右下に **「adkill ✓」バッジ**が出ること
   (モジュール更新は conf 本体を書き換えないので CA は消えないが、念のため毎回確認)

## C. conf 本体の更新 (原則やらない。やむを得ない場合のみ)

**警告**: conf をリモートから再取得すると、ローカル conf に追記されている
**ca-p12 (MITM 用 CA の秘密鍵) が消える**。設定画面は正常に見えるのに復号だけが
無言で止まり、全サイトが素通し (TCP Stream / FINAL,DIRECT) になる。

1. コンフィグタブ → adkill.conf を左スワイプ → **更新**
2. ホームタブ → 接続 OFF → ON
3. **必ずバッジテスト**: `https://example.com` を開く
   - バッジが出る → 完了
   - バッジが出ない → まず下の「トラブルシューティング早見」の段階的確認 (許可リスト/
     スクリプト取得/応答/キャッシュ) を行い、それでも出ない場合のみ次の「CA 再生成手順」へ

### CA 再生成手順 (バッジが出ないとき)

1. コンフィグタブ → conf の **(i) → HTTPS復号 → 証明書** → **新しいCA証明書を生成**
2. **インストール** をタップ → iOS のプロファイルインストール画面に従う
3. **iOS 設定 → 一般 → 情報 → 証明書信頼設定** → 新しい証明書のトグルを **ON**
   (**ここを忘れるのが定番の落とし穴**。プロファイルのインストールと信頼設定 ON は
   別操作で、後者を忘れても Shadowrocket はエラーを出さず復号をスキップする。
   2026-09-09 に実際に起きた障害)
4. 接続 OFF → ON → バッジテストで確認
5. 証明書モジュール (ca-p12 退避) を使っている場合は、**証明書のインストールと
   信頼設定が完了した後に**入れ直す (完了前に入れると競合して復号が動かない)

## D. AdGuard DNS カスタムルールの反映 (端末外の操作)

`adguard_dns_userrules.txt` の変更は自動反映されない。

1. AdGuard DNS ダッシュボード → 対象サーバー → **サーバー設定 → ブロックリスト**
2. 「ユーザールール」にファイルの内容を貼り付けて保存
   (またはカスタムリストとしてこのファイルの raw URL を登録している場合は再取得を待つ)

SR 使用中は SR 層の TINYGIF が先勝ちするため、DNS 側は「SR が OFF のときの保険」。

---

## 今回 (2026-09-10 第4報) の反映手順 — ⚠️ conf 更新 (CA 再設定込み)

第3報の後、livedoor/FNN が繋がらない・Claude/ChatGPT アプリの不具合・
YouTube/Google の画像破損が報告された。SR ログで原因確定:
**包括 MITM (*.com 等) + requires-body が、Connection:close サイトの応答死・
拡張子なし画像/API/SSE の破壊を起こしていた**。
→ **MITM を広告ドメインだけの許可リストに全面転換** (conf の [MITM] hostname を書き換え)。
一般サイト・アプリは今後一切復号されないため、この種の巻き込み事故は構造的に消滅する。

手順:
1. コンフィグタブ → adkill.conf を左スワイプ → **更新**
2. 接続 OFF → ON → `https://example.com` でバッジ確認
3. バッジが出ない場合のみ **C の CA 再生成手順** (生成→インストール→信頼設定 ON) → 再確認
4. 動作確認:
   - blog.livedoor.com / www.fnn.jp → 普通に開ける
   - Claude / ChatGPT アプリ → 正常動作
   - YouTube / Google → アバター・画像が表示される
   - newsdig.tbs.co.jp → 壁なしで読める (スタブ方式・第3報のまま)
   - jetstream.blog → 正常 (Chrome キャッシュ削除済みなら)
5. 注意: 診断バッジ (#adkill) は今後 **example.com 等の検証用ホストでのみ**表示される
   (一般サイトは復号しなくなったため — それが正常)

## (旧) 2026-09-10 第3報の手順 — 実施済み

SR ログ解析の結果:
- newsdig の「接続エラー」の真因 = **TLS ではなく HTTP/1.1 + Connection: close +
  requires-body の組合せで応答が返らない** (復号自体は成功していた。ログにフル URL が
  記録されており CA も生存確認済み)
- 対策: newsdig は MITM 除外のまま、**Ad-Shield の loader.min.js を「ゲートフラグを
  立てるだけの無害スタブ」に 302 リライト**する方式に切替 (モジュールの [URL Rewrite])。
  エミュレータで newsdig が壁なし・スタイル無傷で表示されることを確認済み

手順:
1. **モジュール更新** (コンフィグ → モジュール → adkill MITM除外 → 左スワイプ → 更新)
2. 接続 OFF → ON (custom.list の変更も自動で入る)
3. **newsdig.tbs.co.jp を開く** → 壁・ダイアログ・白画面が出ず記事が読めるはず
4. **jetstream.blog**: 崩れの正体は「旧設定時代に壊れた画像が Chrome に長期キャッシュ
   (最大120日) されたもの」。**Chrome のキャッシュ削除**
   (… → 設定 → プライバシー → 閲覧履歴データの削除 → キャッシュされた画像とファイル)
   をしてから開き直す。先にシークレットタブで開いて画像が出れば原因確定
5. conf の再更新は**不要** (前回の v=3 反映はログで確認済み)

## (旧) 2026-09-10 第2報の手順 — 実施済み

実機スクリーンショットから、jetstream の表示崩れの正体は**画像の全滅**
(同一オリジンのロゴまで壊れる) と判明。原因は conf の `[Script] pattern=^https?://.+` が
**画像・フォント等の全バイナリ応答まで SR にバッファリングさせていた**こと
(SR はバイナリ body の扱いに弱点があり、画像が壊れる)。
pattern を「文書らしい URL」だけに絞る修正を conf に入れたため、
**今回だけは conf 本体の更新が必要** = ca-p12 が消えるので CA 再設定までがワンセット:

1. コンフィグタブ → adkill.conf を左スワイプ → **更新**
2. ホームタブ → 接続 OFF → ON
3. `https://example.com` でバッジ確認 → **ほぼ確実に出ない** (ca-p12 消失のため)
4. **C の「CA 再生成手順」を実施** (生成 → インストール → **信頼設定 ON を忘れずに**)
5. 接続 OFF → ON → バッジ確認 (出るまで 4 をやり直す)
6. **jetstream.blog を開き直す** (Chrome のキャッシュ削除推奨):
   画像が正常に出て、崩れが直っているはず
7. newsdig: 接続はできるが Ad-Shield のダイアログは出る (MITM 除外中のため対策が届かない。
   **OK は押さない** — 先方の誘導ページに飛ばされる。キャンセルは再読み込みされるだけ)。
   ダイアログを出なくするには MITM 復活が必要 → 下の切り分け 3 が必要

## 診断手順 (前回分)

実機で「jetstream 表示崩れ」「newsdig 接続不可」が報告されたため、
newsdig は MITM 除外に戻した (接続不可 > 壁、のため到達性を優先)。
エミュレータ (WebKit/Chromium × 新旧 adkill × DNS層 × UA × ダークモード の全組合せ) では
jetstream の崩れは一切再現しないため、端末側の状態が古い/汚染されている可能性が高い。

1. **B の手順**でモジュールを更新 (newsdig が MITM 除外に戻る = 接続可能になる)
2. 接続 OFF → ON
3. **注入の生存確認**: `https://example.com` でバッジ確認。
   ~~さらに任意のサイトでも URL の末尾に `#adkill` を付けて開くとバッジが出る~~
   **【旧記述・現在は誤り】** 第4報の許可リスト化以降、一般サイトは復号されないため
   `#adkill` バッジは**許可リスト対象ホスト (example.com 等) でのみ**出る。
   一般サイトでバッジが出ないのは正常であり、CA 異常の根拠にはならない
4. **jetstream の表示崩れ**: まず Chrome のキャッシュを削除して再確認
   (Chrome: … → 設定 → プライバシー → 閲覧履歴データの削除 → 「キャッシュされた画像とファイル」)。
   以前の誤爆ルールで汚染されたリソースがキャッシュに残っている可能性があるため。
   それでも崩れる場合は **崩れた画面のスクリーンショットと、
   Shadowrocket データタブのその時間帯のログ**を報告
5. **newsdig**: 除外復帰後は接続できるが Ad-Shield の壁は出る (MITM 不可のため対策注入が
   届かない)。SR の MITM が newsdig でだけ失敗する真因の切り分けのため、
   除外を外した状態で newsdig に接続したときの **SR ログのエラー行**が欲しい
   (データタブ → newsdig.tbs.co.jp の行をタップ)
6. **D の手順**で AdGuard DNS 側に新ドメイン
   (css-load.com / img-load.com / npttech.com / addefend.com / btloader.com /
   blockthrough.com / Ad-Shield 5 ドメイン) を反映

## トラブルシューティング早見

| 症状 | 原因の可能性 | 対処 |
|---|---|---|
| example.com でバッジが出ない | 順に確認: ①そのホストが MITM 許可リストにあるか ②adkill.js が取得できているか (データタブに raw.githubusercontent の行) ③HTML 応答が実際に返っているか・キャッシュ ④ca-p12/証明書信頼設定 | ①〜③を先に確認し、それでも出ない場合のみ C の CA 再生成手順 |
| 一般サイトでバッジが出ない | 正常 (許可リスト外は復号しない設計) | 対処不要 |
| 特定サイトだけ SSL エラー | 証明書ピンニング or ECH | `adkill_mitm.sgmodule` に `-ドメイン` を追加 → B |
| 表示崩れ・ログイン不可 | 注入 JS との相性 | adkill.js の `SKIP_HOSTS` に追加 (軽い順: SKIP → MITM除外) |
| 広告が素通り | ルール未登録 (FINAL,DIRECT) | データタブのログでドメイン特定 → custom.list に追加 → A |
| 「広告ブロッカーを無効に」壁 | 新手のアンチアドブロック | ログの DIRECT 行から配信ドメイン特定 → custom.list へ。だめなら issue として記録 |
