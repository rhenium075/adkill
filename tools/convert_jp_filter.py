#!/usr/bin/env python3
"""AdGuard Japanese Filter -> Surge/Shadowrocket RULE-SET converter.

Fetches domain-blocking sections of the AdGuard Japanese filter (GPLv3,
https://github.com/AdguardTeam/AdguardFilters) and emits a RULE-SET file
of DOMAIN-SUFFIX entries usable with policy REJECT-TINYGIF.

Only pure network domain rules (||domain^ with safe modifiers) are converted.
Cosmetic rules (##), URL-part rules, and exception rules (@@) are skipped.

Usage: python3 tools/convert_jp_filter.py > adkill_jp.list
"""
import re, sys, urllib.request, datetime

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

if __name__ == "__main__":
    today = datetime.date.today().isoformat()
    print(f"# adkill_jp.list — AdGuard Japanese Filter (domain rules) converted to Surge RULE-SET")
    print(f"# Generated: {today} by tools/convert_jp_filter.py")
    print(f"# Source: https://github.com/AdguardTeam/AdguardFilters (JapaneseFilter, GPLv3)")
    print(f"# This is a derivative work; the GPLv3 license of the source applies.")
    for d in convert():
        print(f"DOMAIN-SUFFIX,{d}")
