#!/usr/bin/env python3
"""広域 MITM 用の除外リストを生成する (AdGuard 公開 DB の輸入)。

広域 MITM (全 HTTPS 復号) は証明書ピンニングのあるアプリを TLS 段階で壊すため、
「復号してはならないドメイン」の網羅が生命線になる。自前で世界を列挙する代わりに、
AdGuard が HTTPS フィルタリング用に保守している公開除外 DB
(https://github.com/AdguardTeam/HttpsExclusions) を輸入し、当プロジェクトの
実測分 (tools/mitm_exclusions_extra.txt) とマージする。

採用リスト:
  - issues.txt    : MITM で壊れることが既知のドメイン (全件)
  - android.txt   : モバイルアプリのピンニング系バックエンド (全件。iOS と共通が多い)
  - sensitive.txt : 機微サービス (全件。壊れなくても復号しない方針)
  - banks.txt     : 銀行 (巨大なため .jp と主要国際ブランドのみ抽出)

Usage:
  python tools/build_mitm_exclusions.py            # 除外エントリを stdout に出力 (検査用)
  python tools/build_mitm_exclusions.py --module   # adkill_mitm.sgmodule の hostname 行を書き換え

--module は [MITM] hostname の %APPEND% 行全体を「広域 include + 除外」で再生成する。
生成結果はコミットしてレビューし、モジュール更新でユーザーが明示採用する。
"""
import re
import sys
import os
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODULE = os.path.join(ROOT, "adkill_mitm.sgmodule")
EXTRA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mitm_exclusions_extra.txt")

BASE = "https://raw.githubusercontent.com/AdguardTeam/HttpsExclusions/master/exclusions/"
FULL_LISTS = ["issues.txt", "android.txt", "sensitive.txt"]
BANKS = "banks.txt"
BANK_KEEP = re.compile(r"(\.jp$|visa|mastercard|amex|americanexpress|paypal|stripe|wise\.com|revolut)")

# 広域 include (旧 adkill.conf と同じ TLD ワイルドカード群)
INCLUDES = ("*.com, *.net, *.org, *.jp, *.io, *.co, *.me, *.tv, *.cc, *.fm, *.info, *.biz, "
            "*.xyz, *.site, *.online, *.dev, *.app, *.blog, *.news, *.gg, *.moe, *.wiki, "
            "*.ai, *.to, *.la, *.st, *.asia, *.tech, *.cloud, *.live, *.life, *.media, "
            "*.social, *.video, *.games, *.store, *.shop, *.work, *.tokyo, *.link, *.click, "
            "*.golf, *.promo")

DOMAIN_RE = re.compile(r"^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$")


def fetch(name):
    with urllib.request.urlopen(BASE + name, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def collect():
    domains = set()
    for name in FULL_LISTS:
        for line in fetch(name).splitlines():
            d = line.strip().lower()
            if d and not d.startswith("#") and DOMAIN_RE.match(d):
                domains.add(d)
    for line in fetch(BANKS).splitlines():
        d = line.strip().lower()
        if d and not d.startswith("#") and DOMAIN_RE.match(d) and BANK_KEEP.search(d):
            domains.add(d)
    for line in open(EXTRA, encoding="utf-8"):
        d = line.split("#")[0].strip().lower()
        if d and DOMAIN_RE.match(d):
            domains.add(d)
    # 上位ドメインが除外済みならサブドメインエントリは冗長なので落とす (行長対策)
    out = set()
    for d in sorted(domains, key=lambda x: x.count(".")):
        parts = d.split(".")
        if any(".".join(parts[i:]) in out for i in range(1, len(parts) - 1)):
            continue
        out.add(d)
    return sorted(out)


def main():
    domains = collect()
    # apex とサブドメインの両方を除外する
    entries = ", ".join(f"-{d}, -*.{d}" for d in domains)
    line = f"hostname = %APPEND% {INCLUDES}, {entries}"
    print(f"# 除外ドメイン {len(domains)} 件 / hostname 行 {len(line)} bytes", file=sys.stderr)
    if "--module" in sys.argv:
        txt = open(MODULE, encoding="utf-8").read()
        txt2, n = re.subn(r"^hostname = %APPEND% .*$", line, txt, count=1, flags=re.M)
        if n != 1:
            print("! ERROR: hostname 行が見つからない", file=sys.stderr)
            sys.exit(1)
        open(MODULE, "w", encoding="utf-8", newline="\n").write(txt2)
        print(f"adkill_mitm.sgmodule を更新 ({len(domains)} 除外)", file=sys.stderr)
    else:
        print(line)


if __name__ == "__main__":
    main()
