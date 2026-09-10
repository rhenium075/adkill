#!/usr/bin/env python3
"""AdGuard Japanese Filter -> Surge/Shadowrocket RULE-SET converter.

Fetches domain-blocking sections of the AdGuard Japanese filter (GPLv3,
https://github.com/AdguardTeam/AdguardFilters) and emits a RULE-SET file
of DOMAIN-SUFFIX entries usable with policy REJECT-TINYGIF.

Only pure network domain rules (||domain^ with safe modifiers) are converted.
Cosmetic rules (##), URL-part rules, and exception rules (@@) are skipped.

Usage: python3 tools/convert_jp_filter.py -o adkill_jp.list
   (推奨: -o はテンポラリに書いてから os.replace するので、フェッチ失敗時に
    既存リストが壊れない。"> adkill_jp.list" リダイレクトはスクリプト実行前に
    ファイルを空にしてしまうため非推奨)
"""
import os, re, sys, tempfile, urllib.request, datetime

SECTIONS = [
    "adservers.txt",
    "adservers_firstparty.txt",
    "antiadblock.txt",
]
BASE = "https://raw.githubusercontent.com/AdguardTeam/AdguardFilters/master/JapaneseFilter/sections/"

# modifiers that keep the rule a plain "block whole domain" rule.
# (レビュー R05) $third-party / $script / $image 等はリクエストの範囲を限定する条件であり、
# DOMAIN-SUFFIX (無条件の全遮断) へ変換すると意味が変わる — 例: ||shop.example.jp^$third-party は
# 第三者読み込みのみ遮断だが、変換すると直接アクセスまで遮断してしまう。
# よって「ドメイン全体の遮断」と等価な修飾子のみ許可し、それ以外の条件付きルールは変換しない。
# (再レビュー残件3) $document も除外: メインフレームの文書リクエストのみが対象であり、
# 他サイトからの画像・スクリプト読み込みまで遮断するドメイン全体遮断とは等価でない。
SAFE_MODS = {"important",  # 優先度指定のみ (範囲は不変)
             "all"}        # 全リソース種別 = 無条件と等価
DOMAIN_RE = re.compile(r"^\|\|([a-z0-9][a-z0-9.\-]*\.[a-z]{2,})\^(\$(.+))?$", re.I)

def convert():
    domains = set()
    skipped_mod = 0
    failed = []
    for sec in SECTIONS:
        try:
            txt = urllib.request.urlopen(BASE + sec, timeout=30).read().decode("utf-8", "replace")
        except Exception as e:
            print(f"! WARN: could not fetch {sec}: {e}", file=sys.stderr)
            failed.append(sec)
            continue
        for line in txt.splitlines():
            line = line.strip()
            if not line or line.startswith("!") or line.startswith("@@"):
                continue
            m = DOMAIN_RE.match(line)
            if not m:
                continue
            dom, _, mods = m.groups()
            if mods:
                parts = [p.split("=")[0] for p in mods.split(",")]
                # skip rules scoped with domain=/denyallow= etc — context-dependent
                if any(p not in SAFE_MODS for p in parts):
                    skipped_mod += 1
                    continue
            domains.add(dom.lower())
    print(f"! converted {len(domains)} domains, skipped {skipped_mod} scoped rules", file=sys.stderr)
    return sorted(domains), failed

def emit(domains, out):
    today = datetime.date.today().isoformat()
    out.write("# adkill_jp.list — AdGuard Japanese Filter (domain rules) converted to Surge RULE-SET\n")
    out.write(f"# Generated: {today} by tools/convert_jp_filter.py\n")
    out.write("# Source: https://github.com/AdguardTeam/AdguardFilters (JapaneseFilter, GPLv3)\n")
    out.write("# This is a derivative work; the GPLv3 license of the source applies.\n")
    for d in domains:
        out.write(f"DOMAIN-SUFFIX,{d}\n")

if __name__ == "__main__":
    # 先に変換を終えてから出力する。フェッチ失敗時に不完全なリストで
    # adkill_jp.list を上書きすると、端末側の JP ルールが無言で欠けるため
    domains, failed = convert()
    if failed:
        # (レビュー R06) 一部セクションの失敗でも更新を中止する — 残りが件数ガードを
        # 通ってしまうと不完全なリストで既存ファイルを置き換えてしまう
        print(f"! ERROR: {len(failed)} section(s) failed ({', '.join(failed)}) — "
              f"refusing to emit an incomplete list", file=sys.stderr)
        sys.exit(1)
    if len(domains) < 100:  # 正常時は数百件以上。激減は上流の構造変化
        print(f"! ERROR: only {len(domains)} domains converted — refusing to emit "
              f"(upstream format change?)", file=sys.stderr)
        sys.exit(1)
    if len(sys.argv) >= 3 and sys.argv[1] == "-o":
        # テンポラリに書き切ってから os.replace でアトミックに置換する
        dest = sys.argv[2]
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(os.path.abspath(dest)) or ".",
                                   prefix=".jp_list_", text=True)
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
                emit(domains, f)
            os.replace(tmp, dest)
        except BaseException:
            try: os.unlink(tmp)
            except OSError: pass
            raise
        print(f"! wrote {len(domains)} rules to {dest}", file=sys.stderr)
    else:
        emit(domains, sys.stdout)
