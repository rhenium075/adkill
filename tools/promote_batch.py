#!/usr/bin/env python3
"""巡回サイトの一括昇格ツール — 注入対象 (MITM + [Script] pattern) の安全審査を自動化する。

「よく見るサイトが数百単位ある」規模に対応するため、昇格審査 (docs/shadowrocket_update.md
第8報の条件) を機械化する:

  1. Connection: close を明示しない       (requires-body で応答死するクラス)
  2. 施行 CSP を返さない                  (CSP 保持ガードにより注入されず無意味)
  3. 文書が UTF-8                          (SR のバッファは非 UTF-8 を破壊しうる)
  4. HTTPS で 200 が返る                   (別サイトへのリダイレクトは追跡し最終ホストで判定)

Usage:
  python tools/promote_batch.py tools/promote_candidates.txt      # 候補リストを審査
  python tools/promote_batch.py ... --emit                        # 合格ホストのモジュール用断片を出力

【プライバシー】候補は「公開情報のリスト (このリポジトリの candidates ファイル)」に
限定する。SR のログ (復号済み URL = 閲覧履歴) を吸い上げて候補化する機能は
意図的に持たない。閲覧ログの定期的な外部共有を前提とする運用は行わないこと。

出力: ホストごとの PASS/FAIL と理由。--emit で adkill_mitm.sgmodule に貼る
hostname 断片と [Script] pattern 用のホスト選択肢 (alternation) を生成する。

※ 金融・決済・EC の購入導線・メッセージング・証明書ピンニング系 (Apple/Google 等) は
   候補に入れないこと (設計原則 3「壊さない」)。このツールは技術条件しか審査しない。
"""
import concurrent.futures
import gzip
import re
import ssl
import sys
import urllib.error
import urllib.request
import zlib
from urllib.parse import urlparse

UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 26_6_1 like Mac OS X) "
      "AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/152.0.7977.64 Mobile/15E148 Safari/604.1")
TIMEOUT = 12
MAX_REDIRECTS = 4

# 審査対象に含めてはならないもの (誤って候補に入っていても弾く)
POLICY_DENY = re.compile(
    r"(apple\.com|icloud\.com|googleapis\.com|gstatic\.com|googlevideo\.com|googleusercontent\.com|"
    r"google\.(com|co\.jp)$|youtube\.com|line\.me|line-apps\.com|paypay|mufg|smbc|mizuho|"
    r"rakuten-bank|japanpost|sbisec|jcb|visa|master|amex|stripe|checkout|"
    r"docomo|nttdocomo|au\.com|kddi|softbank\.jp|"
    r"anthropic|claude\.ai|openai|chatgpt|"
    r"amazon\.(com|co\.jp)|mercari|twitter\.com|x\.com)")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def fetch(url):
    """1 リクエスト実行。(status, headers(dict小文字), body先頭16KB, 例外文字列) を返す"""
    req = urllib.request.Request(url, headers={
        "User-Agent": UA, "Accept": "text/html,application/xhtml+xml",
        "Accept-Encoding": "gzip, deflate"})
    ctx = ssl.create_default_context()
    opener = urllib.request.build_opener(NoRedirect, urllib.request.HTTPSHandler(context=ctx))
    try:
        with opener.open(req, timeout=TIMEOUT) as r:
            body = r.read(16384)
            enc = (r.headers.get("Content-Encoding") or "").lower()
            try:
                if "gzip" in enc:
                    body = gzip.decompress(body + b"\x00" * 8) if body[:2] == b"\x1f\x8b" else body
                elif "deflate" in enc:
                    body = zlib.decompress(body)
            except Exception:
                pass  # 途中切りの解凍失敗は無視 (charset 判定に使えるだけ使う)
            return r.status, {k.lower(): v for k, v in r.headers.items()}, body, None
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, b"", None
    except Exception as e:
        return None, {}, b"", f"{type(e).__name__}: {e}"


def judge(host):
    """1 ホストを審査して (host, verdict, reason, final_host) を返す"""
    if POLICY_DENY.search(host):
        return host, "DENY", "policy (金融/EC/ピンニング/メッセージング系)", host
    url = f"https://{host}/"
    final_host = host
    for _ in range(MAX_REDIRECTS):
        status, hdrs, body, err = fetch(url)
        if err:
            return host, "FAIL", f"接続不可 ({err[:60]})", final_host
        if status in (301, 302, 303, 307, 308):
            loc = hdrs.get("location", "")
            nxt = urlparse(loc if "://" in loc else f"https://{final_host}{loc}")
            if not nxt.hostname:
                return host, "FAIL", f"不正なリダイレクト ({loc[:50]})", final_host
            # 同一サイト (同 eTLD+1 相当の緩い判定: 末尾一致) のみ追跡
            base = ".".join(host.split(".")[-2:])
            if not nxt.hostname.endswith(base):
                return host, "FAIL", f"別サイトへリダイレクト ({nxt.hostname})", final_host
            final_host = nxt.hostname
            url = f"https://{final_host}{nxt.path or '/'}"
            continue
        break
    else:
        return host, "FAIL", "リダイレクトが深すぎる", final_host
    if status != 200:
        return host, "FAIL", f"HTTP {status}", final_host
    if "close" in (hdrs.get("connection") or "").lower():
        return host, "FAIL", "Connection: close (応答死クラス)", final_host
    if hdrs.get("content-security-policy"):
        return host, "FAIL", "施行 CSP (注入不能)", final_host
    ct = (hdrs.get("content-type") or "").lower()
    if "text/html" not in ct:
        return host, "FAIL", f"文書でない ({ct[:40]})", final_host
    charset = None
    m = re.search(r"charset=([a-z0-9_-]+)", ct)
    if m:
        charset = m.group(1)
    else:
        bm = re.search(rb'charset=["\']?([a-zA-Z0-9_-]+)', body[:4096])
        if bm:
            charset = bm.group(1).decode("ascii", "replace").lower()
    if charset and charset not in ("utf-8", "utf8"):
        return host, "FAIL", f"非 UTF-8 ({charset})", final_host
    if not charset:
        try:
            body.decode("utf-8")
        except UnicodeDecodeError:
            return host, "FAIL", "charset 不明かつ UTF-8 として不正", final_host
    return host, "PASS", "", final_host



def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    emit = "--emit" in sys.argv
    if True:
        hosts = []
        for f in args:
            for line in open(f, encoding="utf-8"):
                line = line.split("#")[0].strip().lower()
                if line and "." in line:
                    hosts.append(line)
        hosts = sorted(set(hosts))
    if not hosts:
        print(__doc__, file=sys.stderr)
        sys.exit(2)

    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as ex:
        for r in ex.map(judge, hosts):
            results.append(r)
            host, verdict, reason, final = r
            note = f" -> {final}" if final != host else ""
            print(f"{verdict:5s} {host}{note}  {reason}", file=sys.stderr)

    passed = sorted({final for _, v, _, final in results if v == "PASS"})
    failed = [(h, r) for h, v, r, _ in results if v == "FAIL"]
    denied = [h for h, v, _, _ in results if v == "DENY"]
    print(f"\n# 結果: PASS {len(passed)} / FAIL {len(failed)} / DENY {len(denied)}", file=sys.stderr)
    if emit:
        print("# ---- adkill_mitm.sgmodule の hostname (%APPEND%) に追記する断片 ----")
        print(", ".join(f"{h}, *.{h}" for h in passed))
        print("# ---- [Script] pattern のホスト選択肢 (alternation) ----")
        print("|".join(h.replace(".", r"\.") for h in passed))
    else:
        for h in passed:
            print(h)


if __name__ == "__main__":
    main()
