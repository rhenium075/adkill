# test_convert.py — convert_jp_filter.py の疑似環境テスト (ネットワークをモック)
import io, os, sys, subprocess, tempfile, importlib.util, unittest.mock as mock

TOOLS = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
CJF = os.path.join(TOOLS, "convert_jp_filter.py")
sys.path.insert(0, TOOLS)
spec = importlib.util.spec_from_file_location("cjf", CJF)
assert spec is not None and spec.loader is not None
cjf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cjf)

FIXTURE = """! comment line
! Homepage: x
||simple-ad.example.com^
||UPPER-CASE.EXAMPLE.JP^
||scoped.example.com^$domain=onlyhere.jp
||withmod.example.com^$third-party
||multi-mod.example.jp^$script,image
||badmod.example.com^$denyallow=a.com
@@||excepted.example.com^
##.cosmetic-rule
example.com##div.ad
/banner\\.gif/
||sub.deep.ad-network.co.jp^
||no-tld^
||url-part.example.com/path^
||important-rule.example.net^$important
||allmod.example.com^$all
||docmod.example.net^$document
"""

passed = failed = 0
fails = []
def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1; print(f"  ok  {name}")
    else:
        failed += 1; fails.append(name + (" — " + detail if detail else "")); print(f"  FAIL {name} {detail}")

print("[1] フィルタ変換ロジック (フィクスチャ)")
def fake_urlopen(url, timeout=30):
    return io.BytesIO(FIXTURE.encode("utf-8"))
with mock.patch.object(cjf.urllib.request, "urlopen", fake_urlopen):
    domains, fetch_failed = cjf.convert('a' * 40)
d = set(domains)
check("フェッチ失敗なし", fetch_failed == [])
check("通常ルールが変換される", "simple-ad.example.com" in d)
check("大文字は小文字化される", "upper-case.example.jp" in d)
check("$domain= スコープ付きはスキップ", "scoped.example.com" not in d)
# (R05) 範囲を限定する修飾子は、無条件のドメイン遮断に変換すると意味が変わるためスキップ
check("$third-party は範囲限定のためスキップ (R05)", "withmod.example.com" not in d)
check("$script,image は範囲限定のためスキップ (R05)", "multi-mod.example.jp" not in d)
check("$denyallow= はスキップ", "badmod.example.com" not in d)
check("例外ルール @@ はスキップ", "excepted.example.com" not in d)
check("コスメティックルールはスキップ", not any("cosmetic" in x for x in d))
check("サブドメイン付きも変換される", "sub.deep.ad-network.co.jp" in d)
check("TLD なしはスキップ", "no-tld" not in d)
check("URL パス付きはスキップ", "url-part.example.com" not in d)
check("$important は変換される (範囲不変)", "important-rule.example.net" in d)
check("$all は変換される (無条件と等価)", "allmod.example.com" in d)
check("$document は範囲限定 (メインフレームのみ) のためスキップ (再レビュー残件3)", "docmod.example.net" not in d)
check("ソート済み", domains == sorted(domains))
check("重複なし", len(domains) == len(set(domains)))

print("[2] フェッチ失敗時に既存リストを壊さない (実エントリーポイントを runpy で実行)")
import runpy
def run_cli(dest, urlopen_impl):
    """実際の __main__ ブロックを、urlopen をモックして実行し終了コードを返す"""
    argv_bak = sys.argv[:]
    sys.argv = ["convert_jp_filter.py", "--source-ref", "a" * 40, "-o", dest]
    try:
        with mock.patch("urllib.request.urlopen", urlopen_impl):
            runpy.run_path(CJF, run_name="__main__")
        return 0
    except SystemExit as e:
        return e.code or 0
    finally:
        sys.argv = argv_bak

with tempfile.TemporaryDirectory() as td:
    dest = os.path.join(td, "adkill_jp.list")
    with open(dest, "w") as f:
        f.write("EXISTING CONTENT\n")
    # (a) 全セクション失敗
    def boom(url, timeout=30):
        raise OSError("network down")
    rc = run_cli(dest, boom)
    check("フェッチ全滅で非ゼロ終了", rc != 0, f"rc={rc}")
    check("全滅時: 既存ファイルが無傷", open(dest, encoding="utf-8").read() == "EXISTING CONTENT\n")
    # (b) 部分失敗 (R06): 1セクションだけ成功 (150件) しても更新しない
    calls = {"n": 0}
    def partial(url, timeout=30):
        calls["n"] += 1
        if calls["n"] == 1:
            lines = "".join(f"||dom{i:04d}.example.com^\n" for i in range(150))
            return io.BytesIO(lines.encode())
        raise OSError("network down")
    rc = run_cli(dest, partial)
    check("部分失敗でも非ゼロ終了 (R06)", rc != 0, f"rc={rc}")
    check("部分失敗時: 既存ファイルが無傷 (R06)", open(dest, encoding="utf-8").read() == "EXISTING CONTENT\n")
    # (c) 全セクション成功なら置換される (正常系)
    def ok(url, timeout=30):
        lines = "".join(f"||dom{i:04d}.example.com^\n" for i in range(150))
        return io.BytesIO(lines.encode())
    rc = run_cli(dest, ok)
    check("全成功で正常終了", rc == 0, f"rc={rc}")
    check("全成功時のみファイルが更新される", "DOMAIN-SUFFIX,dom0000.example.com" in open(dest, encoding="utf-8").read())

print("[3] emit の出力形式")
fake = [f"domain{i:04d}.example.com" for i in range(150)]
buf = io.StringIO()
cjf.emit(fake, buf, 'a' * 40)
out = buf.getvalue()
check("ヘッダに GPLv3 帰属表示がある", "GPLv3" in out and "AdguardTeam/AdguardFilters" in out)
check("全ドメインが DOMAIN-SUFFIX で出力される", out.count("DOMAIN-SUFFIX,") == 150)

check("上流の固定コミットと全入力ファイルを記録", "# Upstream-Commit: " + "a" * 40 in out and out.count("# Input:") == 3)
check("ライセンス本文と通知への案内を出力", "# License-Text:" in out and "# Notices:" in out)
with mock.patch.object(cjf.urllib.request, 'urlopen', fake_urlopen) as unused:
    try:
        cjf.convert('master')
        rejected = False
    except Exception:
        rejected = True
check("可変 ref を拒否", rejected)
seen = []
def record_url(url, timeout=30):
    seen.append(url)
    return fake_urlopen(url, timeout)
with mock.patch.object(cjf.urllib.request, 'urlopen', record_url):
    cjf.convert('b' * 40)
check("全セクションを同一の固定 ref で取得", len(seen) == 3 and all('/' + 'b' * 40 + '/' in url for url in seen))

print("-" * 45)
print(f"pass={passed} fail={failed}")
if fails:
    print("FAILURES:")
    for f in fails: print(" -", f)
    sys.exit(1)
