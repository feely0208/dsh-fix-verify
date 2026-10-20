# 改前改后复核（dsh-fix-verify）

**什么时候用**：用户改完代码后，想知道「之前报的那些问题现在还有没有」。
用户会说：「修完了帮我复核一下」「对比一下改前改后」「还剩几条没修」
「这次改动有没有引入新问题」「给我一份修复证明」。

## 怎么用

```bash
<cli 路径> --before <旧快照目录> --after <新快照目录>        # 核心用法
<cli 路径> --before <旧> --after <新> --quiet                # 只输出结论行（CI）
<cli 路径> --before <旧> --after <新> --json                 # JSON（交给 compliance-doc）
<cli 路径> --before <旧> --after <新> --md 复核报告.md       # Markdown 复核报告
<cli 路径> --root <目录>                                     # 同一目录自比（兼容门禁）
```

规则源发现顺序：`--rules-from` → 本插件 `node_modules/@deepwhale-cn/dsh-*/rules` →
并排安装的 `dsh-*/rules` → 环境变量 `DSH_GUARD_PLUGINS`。
**一个规则源都没发现时 exit 2**，不会把「没检查」当成「0 命中」。

## 怎么准备两份快照

```bash
# git worktree（推荐）
git worktree add /tmp/before HEAD~1
<cli 路径> --before /tmp/before --after .

# 旧 commit 导出
mkdir -p /tmp/before && git archive HEAD~1 | tar -x -C /tmp/before
<cli 路径> --before /tmp/before --after .
```

## 输出格式

四个桶：

| 桶 | 含义 |
|---|---|
| `fixed` 已修复 | 改前有、改后无 |
| `remaining` 遗留 | 改前改后都有 |
| `regressed` 新增回归 | 改前无、改后有 |
| `newFiles` 新增文件 | 改后新出现的文件（只统计） |

比对键是 **`ruleId` + 文件相对路径**，**不含行号**（行号会随改动漂移）。
`--json` 条目字段：`ruleId / title / severity / source / advice / file / beforeLine / afterLine`。

## 退出码

| 码 | 含义 |
|---|---|
| `0` | 遗留 0、新增回归 0 |
| `1` | 还有遗留或新增回归 |
| `2` | 参数 / 目录 / 规则源错误（包括「没有发现任何规则源」） |

## 怎么读结果

1. **先看「规则源」和「扫描文件数」**。规则源 0 个时工具会 exit 2，不会假绿。
2. **`remaining` 优先处理**：改前报、改后还报，说明这次没修到。
3. **`regressed` 要当心**：这是本次改动带出来的新问题，往往比遗留更值得先看。
4. **`fixed` 只代表这套规则不再报**，不代表问题一定彻底解决，代码 review 仍要做。
5. 行号只作定位参考：`旧行号 → 新行号` 两边不一致很正常（文件增删行导致）。

## 不要做什么

- 不要把它当扫描器 —— 它不新增判据，规则来自已安装的守护插件
- 不要因为遗留 0 就说「项目安全 / 合规」—— 未命中不等于没有问题
- 不要用行号做修复判定 —— 以「规则 ID + 文件」为准
- 不要在规则源为空时相信输出 —— 那是 exit 2，不是全绿
