#!/bin/bash
# dsh-fix-verify · 真行为验证
#
# 不依赖仓库里其它真实插件是否安装：所有比对都在一个隔离副本里跑，
# 规则源只用 tests/fixtures/fake-plugins 里的假插件。
set -uo pipefail
export PATH="/usr/local/bin:$PATH"
cd "$(dirname "$0")/.."
ROOT="$PWD"
PASS=0; FAIL=0
ok(){ echo "  ✅ $1"; PASS=$((PASS+1)); }
bad(){ echo "  ❌ $1"; FAIL=$((FAIL+1)); }

echo ""; echo "  $(node -p "require('./package.json').name") · 改前改后复核验证"
echo "  ────────────────────────────────────────────────"

# ── 隔离环境 ────────────────────────────────────────────────────
# 为什么复制到临时目录：插件会按「并排安装的 dsh-*/rules」自动发现规则源。
# 在 monorepo 里直接跑会把 36 个真实插件的规则全带上，测试断言就不稳定了。
# 隔离副本的父目录只放它自己，自动发现只能看到 --rules-from 指定的假插件。
TMPBASE=$(mktemp -d "$ROOT/tests/.tmp.XXXXXX") || { echo "无法创建临时目录"; exit 1; }
trap 'rm -rf "$TMPBASE"' EXIT
ISO="$TMPBASE/iso"
mkdir -p "$ISO"
cp -R bin lib package.json "$ISO/"
mkdir -p "$ISO/node_modules/@deepwhale-cn"
CORE_DIR=$(cd ../core && pwd)
ln -s "$CORE_DIR" "$ISO/node_modules/@deepwhale-cn/dsh-guard-core"
BEFORE="$ROOT/tests/fixtures/before"
AFTER="$ROOT/tests/fixtures/after"
CLEAN="$ROOT/tests/fixtures/after-clean"
FAKE="$ROOT/tests/fixtures/fake-plugins"
EMPTY="$ROOT/tests/fixtures/empty-rules"
CLI="$ISO/bin/cli.mjs"

# 0) 两个工具插件都不应该有 rules/ 目录（它们不新增判据）
[ ! -d rules ] && ok "本插件没有 rules/ 目录（不新增判据）" || bad "不应存在 rules/ 目录"

echo ""; echo "  【1】有遗留/回归 → exit 1，且四个桶各自正确"
J=$(node "$CLI" --before "$BEFORE" --after "$AFTER" --rules-from "$FAKE" --json 2>"$TMPBASE/err1")
E1=$?
echo "$J" | python3 -c "import json,sys;json.load(sys.stdin)" 2>/dev/null \
  && ok "输出是合法 JSON" || { bad "JSON 解析失败"; cat "$TMPBASE/err1" | head -5; }
[ "$E1" = "1" ] && ok "有遗留/回归时 exit 1（实际 $E1）" || bad "退出码应为 1，实际 $E1"
c=$(echo "$J" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['summary']['fixed'])")
[ "$c" = "1" ] && ok "已修复 1 条" || bad "已修复应为 1，实际 ${c:-无}"
c=$(echo "$J" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['summary']['remaining'])")
[ "$c" = "1" ] && ok "遗留 1 条" || bad "遗留应为 1，实际 ${c:-无}"
c=$(echo "$J" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['summary']['regressed'])")
[ "$c" = "1" ] && ok "新增回归 1 条" || bad "新增回归应为 1，实际 ${c:-无}"
c=$(echo "$J" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['summary']['newFiles'])")
[ "$c" = "1" ] && ok "新增文件统计 1 个" || bad "新增文件应为 1，实际 ${c:-无}"

# 具体 ruleId 必须落在正确的桶里 —— 只数数量会被「串桶」骗过
R=$(echo "$J" | python3 -c "import json,sys;d=json.load(sys.stdin);print(','.join(x['ruleId'] for x in d['fixed']))")
[ "$R" = "FAKE-EVAL" ] && ok "fixed 桶 = FAKE-EVAL" || bad "fixed 桶错误：${R:-空}"
R=$(echo "$J" | python3 -c "import json,sys;d=json.load(sys.stdin);print(','.join(x['ruleId'] for x in d['remaining']))")
[ "$R" = "FAKE-INNERHTML" ] && ok "remaining 桶 = FAKE-INNERHTML" || bad "remaining 桶错误：${R:-空}"
R=$(echo "$J" | python3 -c "import json,sys;d=json.load(sys.stdin);print(','.join(x['ruleId'] for x in d['regressed']))")
[ "$R" = "FAKE-CONSOLE" ] && ok "regressed 桶 = FAKE-CONSOLE" || bad "regressed 桶错误：${R:-空}"

# 行号漂移：同一个 key 改前行号 3、改后行号 4，仍应判为「遗留」
R=$(echo "$J" | python3 -c "
import json,sys
d=json.load(sys.stdin)
x=[i for i in d['remaining'] if i['ruleId']=='FAKE-INNERHTML'][0]
print('%s:%s' % (x['beforeLine'], x['afterLine']))")
[ "$R" = "3:4" ] && ok "行号漂移（3→4）不影响比对（键不含行号）" || bad "行号漂移处理错误：${R:-空}"

# 规则源发现：短名、条数、地址都对
R=$(echo "$J" | python3 -c "
import json,sys
d=json.load(sys.stdin)
s=d['rules']['sources']
print('%d/%s/%s' % (len(s), s[0]['short'], s[0]['count']))")
[ "$R" = "1/fake-a/3" ] && ok "规则源发现：1 个来源、short=fake-a、3 条规则" || bad "规则源发现错误：${R:-空}"

# 重复 --rules-from 同一目录 → realpath 去重，仍只有 1 个来源
J2=$(node "$CLI" --before "$BEFORE" --after "$AFTER" --rules-from "$FAKE" --rules-from "$FAKE" --json 2>/dev/null)
R=$(echo "$J2" | python3 -c "import json,sys;print(len(json.load(sys.stdin)['rules']['sources']))")
[ "$R" = "1" ] && ok "重复规则源按 realpath 去重（仍 1 个）" || bad "去重失败：${R:-空} 个来源"

echo ""; echo "  【2】全部修完 → exit 0"
node "$CLI" --before "$BEFORE" --after "$CLEAN" --rules-from "$FAKE" --quiet >"$TMPBASE/q2" 2>&1
E2=$?
[ "$E2" = "0" ] && ok "遗留与回归归零时 exit 0（实际 $E2）" || bad "应为 exit 0，实际 $E2"
J=$(node "$CLI" --before "$BEFORE" --after "$CLEAN" --rules-from "$FAKE" --json 2>/dev/null)
R=$(echo "$J" | python3 -c "import json,sys;d=json.load(sys.stdin);print('%d/%d/%d'%(d['summary']['fixed'],d['summary']['remaining'],d['summary']['regressed']))")
[ "$R" = "2/0/0" ] && ok "修完的快照：修复 2 / 遗留 0 / 回归 0" || bad "修完桶结果错误：${R:-空}"

echo ""; echo "  【3】--root X 等价于 --before X --after X"
node "$CLI" --root "$CLEAN" --rules-from "$FAKE" --quiet >"$TMPBASE/q3" 2>&1
E3=$?
[ "$E3" = "0" ] && ok "--root 干净目录 exit 0" || bad "--root 退出码应为 0，实际 $E3"
grep -q "修复 0 · 遗留 0 · 新增回归 0" "$TMPBASE/q3" \
  && ok "--root 自比：修复 0 / 遗留 0 / 回归 0" || bad "--root 自比输出异常：$(cat "$TMPBASE/q3")"

echo ""; echo "  【4】规则源为空 → exit 2（绝不假绿）"
node "$CLI" --before "$BEFORE" --after "$AFTER" --rules-from "$EMPTY" >"$TMPBASE/o4" 2>&1
E4=$?
[ "$E4" = "2" ] && ok "规则源为 0 时 exit 2（实际 $E4）" || bad "规则源为 0 应 exit 2，实际 $E4"
grep -q "没有发现任何规则源" "$TMPBASE/o4" \
  && ok "输出明确说明「没有发现任何规则源」" || bad "缺少规则源为空的明确说明"
grep -q -- "--rules-from" "$TMPBASE/o4" \
  && ok "输出给出 --rules-from 的补救方式" || bad "缺少 --rules-from 提示"
if echo "$TMPBASE/o4" | grep -q "0 命中"; then bad "输出里出现「0 命中」措辞，有假绿风险"; else ok "没有把未检查说成「0 命中」"; fi

echo ""; echo "  【5】--md 复核报告"
node "$CLI" --before "$BEFORE" --after "$AFTER" --rules-from "$FAKE" --md "$TMPBASE/report.md" --quiet >/dev/null 2>&1
[ -s "$TMPBASE/report.md" ] && ok "--md 生成了非空报告" || bad "--md 未生成报告"
for kw in "改前改后复核报告" "已修复" "遗留" "新增回归" "不构成安全结论" "复核方式"; do
  grep -q "$kw" "$TMPBASE/report.md" && ok "报告含「$kw」" || bad "报告缺「$kw」"
done

echo ""; echo "  【6】参数与退出码语义"
node "$CLI" --help >"$TMPBASE/o6" 2>&1
[ "$?" = "0" ] && ok "--help exit 0" || bad "--help 退出码异常"
grep -q "退出码" "$TMPBASE/o6" && ok "--help 写明了退出码语义" || bad "--help 缺退出码说明"
node "$CLI" --after "$AFTER" --rules-from "$FAKE" >/dev/null 2>&1
[ "$?" = "2" ] && ok "缺 --before → exit 2" || bad "缺 --before 应 exit 2"
node "$CLI" --before /nonexistent-xyz --after "$AFTER" --rules-from "$FAKE" >/dev/null 2>&1
[ "$?" = "2" ] && ok "目录不存在 → exit 2" || bad "目录不存在应 exit 2"
node "$CLI" --bogus >/dev/null 2>&1
[ "$?" = "2" ] && ok "未知参数 → exit 2" || bad "未知参数应 exit 2"

echo ""
echo "  ────────────────────────────────────────────────"
echo "  通过 $PASS · 失败 $FAIL"; echo ""
[ "$FAIL" -eq 0 ] || exit 1
