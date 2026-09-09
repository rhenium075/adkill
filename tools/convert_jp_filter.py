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

# modifiers that keep the rule a plain "block whole domain" rule
SAFE_MODS = {"third-party", "~third-party", "all", "document", "script", "image",
             "subdocument", "xmlhttprequest", "media", "popup", "important", "frame"}
DOMAIN_RE = re.compile(r"^\|\|([a-z0-9][a-z0-9.\-]*\.[a-z]{2,})\^(\$(.+))?$", re.I)

def convert():
    domains = set()
    skipped_mod = 0
    for sec in SECTIONS:
        try:
            txt = urllib.request.urlopen(BASE + sec, timeout=30).read().decode("utf-8", "replace")
        except Exception as e:
            print(f"! WARN: could not fetch {sec}: {e}", file=sys.stderr)
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
    return sorted(domains)

def emit(domains, out):
    today = datetime.date.today().isoformat()
    out.write("# adkill_jp.list — AdGuard Japanese Filter (domain rules) converted to Surge RULE-SET\n")
    out.write(f"# Generated: {today} by tools/convert_jp_filter.py\n")
    out.write("# Source: https://github.com/AdguardTeam/AdguardFilters (JapaneseFilter, GPLv3)\n")
    out.write("# This is a derivative work; the GPLv3 license of the source applies.\n")
    for d in domains:
        out.write(f"DOMAIN-SUFFIX,{d}\n")

if __name__ == "__main__":
    # 先に変換を終えてから出力する。フェッチ全滅時にヘッダだけの空リストで
    # adkill_jp.list を上書きすると、端末側の JP ルールが無言で消えるため
    domains = convert()
    if len(domains) < 100:  # 正常時は数千件。激減はフェッチ失敗か上流の構造変化
        print(f"! ERROR: only {len(domains)} domains converted — refusing to emit "
              f"(network failure or upstream format change?)", file=sys.stderr)
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
