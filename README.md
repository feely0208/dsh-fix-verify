# @deepwhale-cn/dsh-fix-verify

[![dshfind 收录](https://dshfind.com/api/badge/feely0208/dsh-fix-verify?lang=zh)](https://dshfind.com/zh/plugins/feely0208/dsh-fix-verify)

[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/zh/plugins/feely0208/dsh-fix-verify)

**改之前报的那几条，改完到底还在不在？同一套规则跑两遍，修复 / 遗留 / 新增回归一次说清。**

**关键词**：改前改后对比 · 修复验证 · 修复复核 · 回归检查 · 安全体检 · 合规报告 · 自查表 · 整改复核 · 一键体检 · CI 门禁

---

## 先说清楚它是什么、不是什么

**是**：一个「改前改后」的比对器。把你**改之前**的代码快照和**改之后**的快照各跑一遍
**同一套规则**，然后按「规则 ID + 文件相对路径」逐条对照，告诉你：

- ✅ **已修复**：改前报、改后不报了 —— 这条真的没了
- ⚠️ **遗留**：改前改后都报 —— 还没修掉
- ❗ **新增回归**：改前不报、改后报了 —— 这次改动带出了新问题
- 📄 **新增文件**：改后多出来的文件（只统计，不参与问题判定）

**不是**：
- ❌ **不是扫描器本身** —— 它不新增判据，规则来自你已经装好的深鲸守护插件（SBOM、密钥、日志、PII……）
- ❌ **不看你「改得好不好」** —— 只看同一套规则前后两次结果对不对得上
- ❌ **不下安全 / 合规结论** —— 报出来是提示确认，不是判定违规
- ❌ **不保证「全绿=没问题」** —— 规则没覆盖到的地方，它检查不出来；未命中不等于没有问题

**一句话分界**：别的插件负责「查」，它负责「前后两次查的结果对得上吗」。

```
dsh-sbom / dsh-cn-log-retention ...  = 查【这次】有没有问题
dsh-fix-verify                       = 查【改前 → 改后】问题到底少了没有
dsh-compliance-doc                   = 把结果变成能交出去的自查表 / 整改说明 / 合规证明
```

---

## 它怎么工作

1. 自动发现你装好的守护插件规则（`--rules-from` / `node_modules` / 并排安装 / `DSH_GUARD_PLUGINS`）；
2. 对 `--before` 和 `--after` 两个目录各跑一遍**完全相同**的规则；
3. 用 `ruleId + 文件相对路径` 做比对键 —— **不含行号**：
   加一行注释，行号就从 3 漂到 4，用行号当键会把「没修」误判成「修了」；
4. 输出四个桶 + 退出码。

规则源**一个都没发现**时，它会直接报错退出（exit 2），
并告诉你装了哪些插件、怎么用 `--rules-from` 指定 —— **绝不会把「没检查」输出成「0 命中」**。

---

## 用法

```bash
# 改前 / 改后两份快照对比（最常用）
dsh-fix-verify --before ./snapshot-old --after ./snapshot-new

# 只看结论行（适合挂 CI）
dsh-fix-verify --before old --after new --quiet

# 输出 JSON，交给 dsh-compliance-doc 生成交付文档
dsh-fix-verify --before old --after new --json > fix-verify.json

# 额外输出 Markdown 复核报告（可截图存档）
dsh-fix-verify --before old --after new --md 复核报告.md

# 兼容门禁脚本：同一个目录同时作为改前/改后
dsh-fix-verify --root .

# 指定规则源目录（目录下可以是 dsh-*/rules，也可以直接是插件根目录）
dsh-fix-verify --before old --after new --rules-from /path/to/plugins
```

### 怎么准备两份快照

```bash
# 方式 1：git worktree（推荐，最干净）
git worktree add /tmp/before HEAD~1
dsh-fix-verify --before /tmp/before --after .

# 方式 2：从旧 commit 导出
mkdir -p /tmp/before && git archive HEAD~1 | tar -x -C /tmp/before
dsh-fix-verify --before /tmp/before --after .

# 方式 3：直接对两个目录跑（不要求是 git 仓库）
dsh-fix-verify --before ./backup --after ./project
```

---

## 输出与退出码

```
  规则源  1 个插件 / 3 条规则  [fake-a(3)]
  扫描    旧 4 文件 → 新 5 文件 · 运行规则 3/3 · 非文本跳过 0

  修复 1 · 遗留 1 · 新增回归 1 · 新增文件 1

  【已修复】改前有、改后无
  | 状态 | 严重度 | 规则 | 文件 | 旧行号 → 新行号 |
  | ✅已修复 | high | FAKE-EVAL | src/app.js | 5 → — |

  【遗留】两边都有
  | ⚠️遗留 | medium | FAKE-INNERHTML | src/render.js | 3 → 4 |
```

| 退出码 | 含义 |
|---|---|
| `0` | 遗留 0 且新增回归 0（可以放行） |
| `1` | 还有遗留或新增回归（先处理再复核） |
| `2` | 参数错误、目录不存在、或**没有发现任何规则源**（没检查，不算通过） |

`--json` 输出里每个桶的条目都带 `ruleId / title / severity / source / advice / file /
beforeLine / afterLine`，可直接交给 `dsh-compliance-doc`。

---

## 规则从哪来

按顺序自动发现，同目录按 realpath 去重：

1. `--rules-from` 指定的目录（可重复；目录下可放多个 `dsh-*/rules`）
2. `<本插件>/node_modules/@deepwhale-cn/dsh-*/rules`
3. 与本插件并排安装的 `dsh-*/rules`
4. 环境变量 `DSH_GUARD_PLUGINS`（冒号分隔）

只认「含 `rules/*.json` 且至少 1 条合法规则」的目录；每个来源会标注插件短名。
**插件没装、规则没找到 → exit 2**：宁可失败，也不给你一个假的「全部修复」。

---

## 不要做什么

- 不要用它替代扫描插件 —— 它是比对器，不产生新判据
- 不要把「遗留 0」当成「项目没问题」—— 只代表**当前规则集**在**这两个快照**上没报
- 不要用行号判断是否修好 —— 以「规则 ID + 文件」为准
- 不要在规则源为空时相信输出 —— 它会 exit 2，请先装插件或用 `--rules-from`

## 安装

```bash
dsh plugin --profile web add @deepwhale-cn/dsh-fix-verify
```

## License

MIT © 深鲸 DeepWhale

## 深鲸网安守护系列（共 39 个）

> 一个插件做一件事。**安全问题是链式的** —— 配套用才完整。

**国内合规**（12）｜ [等保对照](https://github.com/feely0208/dsh-cn-mlps) · [日志留存](https://github.com/feely0208/dsh-cn-log-retention) · [备案公示](https://github.com/feely0208/dsh-cn-filing) · [用户同意](https://github.com/feely0208/dsh-consent-guard) · [个人信息权利](https://github.com/feely0208/dsh-data-rights) · [未成年人保护](https://github.com/feely0208/dsh-minor-guard) · [影响评估](https://github.com/feely0208/dsh-pipia) · [数据分类分级](https://github.com/feely0208/dsh-data-classify) · [算法备案](https://github.com/feely0208/dsh-algorithm-filing) · [数据出境](https://github.com/feely0208/dsh-cn-data-export) · [国密合规](https://github.com/feely0208/dsh-cn-crypto) · [AI 内容标识](https://github.com/feely0208/dsh-cn-ai-labeling)

**AI 与 Agent 治理**（6）｜ [AI 输出信任](https://github.com/feely0208/dsh-ai-output-trust) · [外部内容信任](https://github.com/feely0208/dsh-content-trust) · [MCP 安全](https://github.com/feely0208/dsh-mcp-audit) · [Agent 权限](https://github.com/feely0208/dsh-agent-scope) · [策略核对](https://github.com/feely0208/dsh-agent-policy) · [可疑指令](https://github.com/feely0208/dsh-phishing-guard)

**数据与凭据**（5）｜ [敏感数据](https://github.com/feely0208/dsh-data-scan) · [密钥轮换](https://github.com/feely0208/dsh-key-rotate) · [数据留存](https://github.com/feely0208/dsh-data-lifecycle) · [配置审计](https://github.com/feely0208/dsh-env-audit) · [密钥扫描](https://github.com/feely0208/dsh-secret-scan)

**供应链与构建**（5）｜ [开源许可](https://github.com/feely0208/dsh-license-guard) · [依赖投毒](https://github.com/feely0208/dsh-dep-audit) · [CI 安全](https://github.com/feely0208/dsh-ci-guard) · [工具审查](https://github.com/feely0208/dsh-tool-vet) · [物料清单](https://github.com/feely0208/dsh-sbom)

**权限与应急**（3）｜ [最小权限](https://github.com/feely0208/dsh-least-privilege) · [告警外发](https://github.com/feely0208/dsh-alert-relay) · [应急证据包](https://github.com/feely0208/dsh-incident-package)

**行业专项**（4）｜ [医疗行业专项](https://github.com/feely0208/dsh-industry-medical) · [教育行业专项](https://github.com/feely0208/dsh-industry-education) · [金融行业专项](https://github.com/feely0208/dsh-industry-finance) · [地方数据条例](https://github.com/feely0208/dsh-local-regulation)

**编排与交付**（4）｜ [一键体检](https://github.com/feely0208/dsh-guard-suite) · [改前改后复核](https://github.com/feely0208/dsh-fix-verify) · [合规可交付文档](https://github.com/feely0208/dsh-compliance-doc) · [整改建议](https://github.com/feely0208/dsh-remediation)

都在 DSH 插件市场（dsh-plugin.org）、npm 和 deepwhale.org.cn/guard.html 上。

---

<p align="right"><a href="https://deepwhale.org.cn"><img src="https://www.deepwhale.org.cn/images/badge/deepwhale-badge.png" alt="powered by dwh" height="20"></a></p>
