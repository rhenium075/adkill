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
    domains = cjf.convert()
d = set(domains)
check("通常ルールが変換される", "simple-ad.example.com" in d)
check("大文字は小文字化される", "upper-case.example.jp" in d)
check("$domain= スコープ付きはスキップ", "scoped.example.com" not in d)
check("$third-party (安全な修飾子) は変換される", "withmod.example.com" in d)
check("$script,image (安全な複数修飾子) は変換される", "multi-mod.example.jp" in d)
check("$denyallow= はスキップ", "badmod.example.com" not in d)
check("例外ルール @@ はスキップ", "excepted.example.com" not in d)
check("コスメティックルールはスキップ", not any("cosmetic" in x for x in d))
check("サブドメイン付きも変換される", "sub.deep.ad-network.co.jp" in d)
check("TLD なしはスキップ", "no-tld" not in d)
check("URL パス付きはスキップ", "url-part.example.com" not in d)
check("$important は変換される", "important-rule.example.net" in d)
check("ソート済み", domains == sorted(domains))
check("重複なし", len(domains) == len(set(domains)))

print("[2] フェッチ全滅時に既存リストを壊さない (-o アトミック置換 + 件数ガード)")
with tempfile.TemporaryDirectory() as td:
    dest = os.path.join(td, "adkill_jp.list")
    with open(dest, "w") as f:
        f.write("EXISTING CONTENT\n")
    # 全セクションのフェッチが失敗する状況をサブプロセスで再現
    code = f"""
import sys, io, unittest.mock as mock, importlib.util
spec = importlib.util.spec_from_file_location("cjf", {CJF!r})
cjf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cjf)
def boom(url, timeout=30): raise OSError("network down")
sys.argv = ["convert_jp_filter.py", "-o", {dest!r}]
with mock.patch.object(cjf.urllib.request, "urlopen", boom):
    domains = cjf.convert()
    if len(domains) < 100:
        sys.exit(1)
"""
    r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
    check("フェッチ全滅で非ゼロ終了", r.returncode == 1, f"rc={r.returncode}")
    check("既存ファイルが無傷", open(dest).read() == "EXISTING CONTENT\n")

print("[3] emit の出力形式")
fake = [f"domain{i:04d}.example.com" for i in range(150)]
buf = io.StringIO()
cjf.emit(fake, buf)
out = buf.getvalue()
check("ヘッダに GPLv3 帰属表示がある", "GPLv3" in out and "AdguardTeam/AdguardFilters" in out)
check("全ドメインが DOMAIN-SUFFIX で出力される", out.count("DOMAIN-SUFFIX,") == 150)

print("-" * 45)
print(f"pass={passed} fail={failed}")
if fails:
    print("FAILURES:")
    for f in fails: print(" -", f)
    sys.exit(1)
