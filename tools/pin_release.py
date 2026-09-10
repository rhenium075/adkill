#!/usr/bin/env python3
"""実行コードの参照 SHA を固定・更新するツール (更新経路の固定)。

adkill_mitm.sgmodule 内の adkill.js / adshield_stub.js への参照を、
検証済みコミットの完全 SHA に書き換える。

Usage:
    python tools/pin_release.py <40桁の完全コミットSHA>

運用 (コード更新時):
    1. main で修正し、tools/tests のテストを全て通す
    2. コミットして SHA を控える
    3. python tools/pin_release.py <そのSHA> → モジュール内の参照が新 SHA になる
    4. これをコミット & push → ユーザーにモジュール更新を案内 (= 「この版を採用」)
    ロールバックは旧 SHA で同じ手順を踏むだけ。

これは参照先の固定であり、本文の暗号学的検証ではない (GitHub/CDN/TLS への信頼は残る)。
"""
import re
import subprocess
import sys
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODULE = os.path.join(ROOT, "adkill_mitm.sgmodule")
PINNED_FILES = ["adkill.js", "adshield_stub.js"]


def main():
    if len(sys.argv) != 2 or not re.fullmatch(r"[0-9a-f]{40}", sys.argv[1]):
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    sha = sys.argv[1]
    # 対象コミットに固定対象ファイルが存在するか検証
    for f in PINNED_FILES:
        r = subprocess.run(["git", "-C", ROOT, "cat-file", "-e", f"{sha}:{f}"],
                           capture_output=True)
        if r.returncode != 0:
            print(f"! ERROR: コミット {sha[:12]} に {f} が存在しない", file=sys.stderr)
            sys.exit(1)
    txt = open(MODULE, encoding="utf-8").read()
    n = 0
    # raw.githubusercontent.com/rhenium075/adkill/<ref>/adkill.js
    txt, c = re.subn(r"(raw\.githubusercontent\.com/rhenium075/adkill/)[^/]+(/adkill\.js)",
                     rf"\g<1>{sha}\g<2>", txt)
    n += c
    # cdn.jsdelivr.net/gh/rhenium075/adkill@<ref>/adshield_stub.js
    txt, c = re.subn(r"(cdn\.jsdelivr\.net/gh/rhenium075/adkill@)[^/]+(/adshield_stub\.js)",
                     rf"\g<1>{sha}\g<2>", txt)
    n += c
    if n == 0:
        print("! ERROR: 書き換え対象の参照が見つからない", file=sys.stderr)
        sys.exit(1)
    open(MODULE, "w", encoding="utf-8", newline="\n").write(txt)
    print(f"pinned {n} reference(s) to {sha}")


if __name__ == "__main__":
    main()
