#!/usr/bin/env python3
"""巡回サイトの一括昇格ツール — 注入対象 (MITM + [Script] pattern) の安全審査を自動化する。

「よく見るサイトが数百単位ある」規模に対応するため、昇格審査 (docs/shadowrocket_update.md
第8報の条件) を機械化する:

  1. Connection: close を明示しない       (requires-body で応答死するクラス)
  2. 施行 CSP を返さない                  (CSP 保持ガードにより注入されず無意味)
  3. 文書が UTF-8                          (SR のバッファは非 UTF-8 を破壊しうる)
  4. HTTPS で 200 が返る                   (同一ホストへの転送のみ追跡)

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
import re
import ssl
import sys
import urllib.error
import urllib.request
import zlib
from urllib.parse import urlparse, urljoin
from html.parser import HTMLParser

UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 26_6_1 like Mac OS X) "
      "AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/152.0.7977.64 Mobile/15E148 Safari/604.1")
TIMEOUT = 12
MAX_REDIRECTS = 4
MAX_BODY = 1024 * 1024

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
    """1 リクエスト実行。(status, headers(dict小文字), 検査上限以内の完全body, 例外文字列) を返す"""
    req = urllib.request.Request(url, headers={
        "User-Agent": UA, "Accept": "text/html,application/xhtml+xml",
        "Accept-Encoding": "gzip, deflate"})
    ctx = ssl.create_default_context()
    opener = urllib.request.build_opener(NoRedirect, urllib.request.HTTPSHandler(context=ctx))
    try:
        with opener.open(req, timeout=TIMEOUT) as r:
            body = r.read(MAX_BODY + 1)
            if len(body) > MAX_BODY:
                return None, {}, b"", "response exceeds inspection limit"
            enc = (r.headers.get("Content-Encoding") or "").lower()
            try:
                if enc in ("gzip", "deflate"):
                    decoder = zlib.decompressobj(31 if enc == "gzip" else zlib.MAX_WBITS)
                    body = decoder.decompress(body, MAX_BODY + 1)
                    if len(body) > MAX_BODY or not decoder.eof or decoder.unused_data:
                        raise ValueError("incomplete/oversized compressed response")
                elif enc and enc != "identity":
                    raise ValueError("unsupported content encoding")
            except (ValueError, zlib.error) as e:
                return None, {}, b"", str(e)
            return r.status, {k.lower(): v for k, v in r.headers.items()}, body, None
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, b"", None
    except Exception as e:
        return None, {}, b"", f"{type(e).__name__}: {e}"


class MetaCSP(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.found = False
        self.charset = None

    def handle_starttag(self, tag, attrs):
        if tag.lower() != "meta":
            return
        attrs = dict(attrs)
        if (attrs.get("http-equiv") or "").strip().lower() == "content-security-policy":
            self.found = True
        if attrs.get("charset"):
            self.charset = attrs["charset"].strip().lower()
        elif (attrs.get("http-equiv") or "").lower() == "content-type":
            m = re.search(r"charset\s*=\s*[\"']?([a-zA-Z0-9_-]+)", attrs.get("content") or "")
            if m:
                self.charset = m.group(1).lower()


def judge(host):
    """Probe one public URL. PASS is evidence for that response, never for subdomains."""
    host = host.lower()
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+", host):
        return host, "FAIL", "invalid hostname", host
    url = f"https://{host}/"
    for _ in range(MAX_REDIRECTS + 1):
        current = urlparse(url)
        if POLICY_DENY.search(current.hostname):
            return host, "DENY", "policy (金融/EC/ピンニング/メッセージング系)", current.hostname
        status, hdrs, body, err = fetch(url)
        if err:
            return host, "FAIL", f"接続不可 ({err[:60]})", host
        if status in (301, 302, 303, 307, 308):
            loc = hdrs.get("location", "")
            try:
                nxt = urlparse(urljoin(url, loc))
                if not loc or nxt.scheme != "https" or nxt.username or nxt.password or nxt.port not in (None, 443):
                    raise ValueError("unsafe redirect")
            except ValueError:
                return host, "FAIL", "不正なリダイレクト", host
            if nxt.hostname and POLICY_DENY.search(nxt.hostname):
                return host, "DENY", "redirect target violates policy", nxt.hostname
            # No eTLD+1 guesswork: even www/apex changes need separate explicit review.
            if nxt.hostname != host:
                return host, "FAIL", f"別ホストへリダイレクト ({nxt.hostname})", host
            url = nxt.geturl()
            continue
        break
    else:
        return host, "FAIL", "リダイレクトが深すぎる", host
    if status != 200:
        return host, "FAIL", f"HTTP {status}", host
    if "close" in (hdrs.get("connection") or "").lower():
        return host, "FAIL", "Connection: close (実機確認が必要)", host
    if hdrs.get("content-security-policy"):
        return host, "FAIL", "施行 CSP (注入不能)", host
    ct = (hdrs.get("content-type") or "").lower()
    if ct.split(";", 1)[0].strip() != "text/html":
        return host, "FAIL", f"文書でない ({ct[:40]})", host
    try:
        text = body.decode("utf-8-sig", "strict")
    except UnicodeDecodeError:
        return host, "FAIL", "UTF-8 として不正", host
    parser = MetaCSP()
    parser.feed(text)
    if parser.found:
        return host, "FAIL", "meta CSP (注入不能)", host
    m = re.search(r"charset\s*=\s*[\"']?([a-z0-9_-]+)", ct)
    charset = m.group(1) if m else parser.charset
    if charset and charset not in ("utf-8", "utf8"):
        return host, "FAIL", f"非 UTF-8 ({charset})", host
    return host, "PASS", "この応答のみ確認。MITM/全パス/サブドメインは未検証", host



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
        print(", ".join(passed))
        print("# ---- [Script] pattern のホスト選択肢 (alternation) ----")
        print("|".join(h.replace(".", r"\.") for h in passed))
    else:
        for h in passed:
            print(h)


if __name__ == "__main__":
    main()
