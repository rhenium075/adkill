# Shadowrocket 更新手順ガイド

adkill の変更を iPhone に反映するための実際の操作手順。
「何を変更したか」によって必要な操作が違うので、まず下の表で確認する。

## 早見表: 変更内容ごとに必要な端末操作

| リポジトリで変更したファイル | 端末で必要な操作 | 反映タイミング |
|---|---|---|
| `adkill_custom.list` / `adkill_jp.list` | **接続 OFF→ON のみ** | 接続時に自動再取得 |
| `adkill.js` | 何もしなくても最大1時間で自動更新。急ぐ場合は接続 OFF→ON | script-update-interval=3600 |
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
   - バッジが出ない → CA が消えている。次の「CA 再生成手順」へ

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

## 今回 (2026-09-09) の変更の反映手順

newsdig の Ad-Shield 壁対策一式を反映する:

1. **B の手順**でモジュールを更新 (newsdig の MITM 除外が解除される)
2. 接続 OFF → ON (custom.list の新ルールと adkill.js の新スクリプトが入る)
3. `https://example.com` でバッジ確認
4. `https://newsdig.tbs.co.jp` を開く:
   - **期待**: 壁なし・白画面なし・confirm ダイアログなしで記事が読める
   - **TLS エラーが出た場合**: ECH 誤診でなかったということ。
     `adkill_mitm.sgmodule` の hostname 行に `-newsdig.tbs.co.jp` を書き戻して
     commit & push → B の手順で再度モジュール更新
   - **表示が崩れた場合**: adkill.js の `SKIP_HOSTS` に `newsdig.tbs.co.jp` を追加
5. **D の手順**で AdGuard DNS 側に新ドメイン
   (css-load.com / img-load.com / npttech.com / addefend.com / btloader.com /
   blockthrough.com / Ad-Shield 5 ドメイン) を反映

## トラブルシューティング早見

| 症状 | 原因の可能性 | 対処 |
|---|---|---|
| バッジが出ない | ca-p12 消失 or 証明書信頼設定 OFF | C の CA 再生成手順 |
| 特定サイトだけ SSL エラー | 証明書ピンニング or ECH | `adkill_mitm.sgmodule` に `-ドメイン` を追加 → B |
| 表示崩れ・ログイン不可 | 注入 JS との相性 | adkill.js の `SKIP_HOSTS` に追加 (軽い順: SKIP → MITM除外) |
| 広告が素通り | ルール未登録 (FINAL,DIRECT) | データタブのログでドメイン特定 → custom.list に追加 → A |
| 「広告ブロッカーを無効に」壁 | 新手のアンチアドブロック | ログの DIRECT 行から配信ドメイン特定 → custom.list へ。だめなら issue として記録 |
