#!/usr/bin/env node
/**
 * dsh-fix-verify —— 改前改后复核
 *
 * 同一个项目，两份快照，同一套规则跑两遍：
 *   --before 旧快照（改之前导出的目录）
 *   --after  新快照（改完之后的目录）
 *
 * 回答一个问题：**改之前报的那几条，现在真的没了吗？**
 *
 * 比对键 = ruleId + 文件相对路径（不含行号 —— 行号会漂）。
 *
 * 退出码：
 *   0  遗留 0 且新增回归 0
 *   1  还有遗留或新增回归（可挂 CI/门禁）
 *   2  参数错误、目录不存在、或没有发现任何规则源
 */

import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan, walk } from '@deepwhale-cn/dsh-guard-core';
import { discoverRuleSources } from '../lib/discover.mjs';
import { compareFindings, exitCodeFor } from '../lib/verify.mjs';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf-8'));
const TOOL = 'dsh-fix-verify';
const DISCLAIMER =
  '本报告由本地静态检查生成，只用于提示确认与复核，不构成安全结论、合规结论或违规判定；' +
  '未命中不等于没有问题。';

function usage() {
  console.log(`
  ${TOOL} v${pkg.version} · 改前改后复核

  ${pkg.description}

  用法：
    dsh-fix-verify --before <旧快照目录> --after <新快照目录> [选项]

  选项：
    --before <dir>       改之前的快照目录（必填）
    --after <dir>        改之后的快照目录（必填）
    --root <dir>         同一个目录同时作为改前/改后（兼容门禁脚本的调用方式）
    --rules-from <dir>   指定规则源目录（可重复；目录下可以是 dsh-*/rules，也可以直接是插件根）
    --json               输出 JSON（给 compliance-doc / CI 二次处理）
    --md <file>          额外输出 Markdown 复核报告
    --quiet              只输出结论行
    -h, --help           显示帮助

  规则源自动发现顺序：
    1. --rules-from 指定的目录
    2. <本插件>/node_modules/@deepwhale-cn/dsh-*/rules
    3. 与本插件并排安装的 dsh-*/rules
    4. 环境变量 DSH_GUARD_PLUGINS（冒号分隔）

  退出码：
    0  遗留 0 且新增回归 0
    1  还有遗留或新增回归
    2  参数 / 规则源 / 目录错误（**没有发现规则源时失败，绝不报「全绿」**）
`);
}

function die(msg) {
  console.error(`\n  ❌ ${msg}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const opt = { before: null, after: null, root: null, rulesFrom: [], json: false, md: null, quiet: false, help: false };
  const need = (a, i) => {
    const v = argv[i + 1];
    if (!v || v.startsWith('--')) die(`参数 ${a} 缺少值`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--before') { opt.before = need(a, i); i++; }
    else if (a === '--after') { opt.after = need(a, i); i++; }
    else if (a === '--root') { opt.root = need(a, i); i++; }
    else if (a === '--rules-from') { opt.rulesFrom.push(need(a, i)); i++; }
    else if (a === '--json') opt.json = true;
    else if (a === '--md') { opt.md = need(a, i); i++; }
    else if (a === '--quiet') opt.quiet = true;
    else if (a === '-h' || a === '--help') opt.help = true;
    else die(`未知参数：${a}（用 --help 看用法）`);
  }
  return opt;
}

function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

function zeroSourcesMessage(extraDirs, discovery) {
  const searched = [
    `  · --rules-from：${extraDirs.length ? extraDirs.join('  ') : '（未指定）'}`,
    `  · ${join(PKG_ROOT, 'node_modules', '@deepwhale-cn')}/dsh-*/rules`,
    `  · ${join(dirname(PKG_ROOT))}/dsh-*/rules（与工具插件并排安装的位置）`,
    `  · 环境变量 DSH_GUARD_PLUGINS（当前：${process.env.DSH_GUARD_PLUGINS || '未设置'}）`,
  ].join('\n');
  const found = discovery.candidates.length
    ? discovery.candidates.map((c) => `  · ${c.name}（${c.rules} 条规则，来自 ${c.via}）`).join('\n')
    : '  · 一个都没有';
  return `
  ❌ 没有发现任何规则源 —— 拒绝把「没检查」输出成「0 命中」。

  已搜索：
${searched}

  找到的守护插件：
${found}

  怎么办：
    1. 先安装至少一个提供规则的守护插件，例如 @deepwhale-cn/dsh-sbom；
    2. 或用 --rules-from <目录> 指定规则源（目录下可以是 dsh-*/rules，也可以直接是插件根目录）；
    3. 或设置 DSH_GUARD_PLUGINS=<目录1>:<目录2>。

  规则源为 0 时本工具以退出码 2 失败 —— 不会把「没找到插件」当成「全部通过」。
`;
}

function printWarnings(warnings) {
  for (const w of warnings) console.error(`  ⚠️  ${w}`);
}

/** 合并多来源规则；同一 ID 只保留首个（并提示） */
function mergeRules(sources) {
  const byId = new Map();
  const duplicates = [];
  for (const s of sources) {
    for (const r of s.rules) {
      if (byId.has(r.id)) { duplicates.push(r.id); continue; }
      byId.set(r.id, r);
    }
  }
  return { rules: [...byId.values()], duplicates };
}

function lineRange(item) {
  const b = item.beforeLine ? String(item.beforeLine) : '—';
  const a = item.afterLine ? String(item.afterLine) : '—';
  return `${b} → ${a}`;
}

function mdTable(items, statusLabel) {
  const head = '| 状态 | 严重度 | 规则 | 文件 | 旧行号 → 新行号 |\n|---|---|---|---|---|';
  if (!items.length) return `${head}\n| ${statusLabel} | — | — | — | — |`;
  const rows = items.map((i) =>
    `| ${statusLabel} | ${i.severity} | \`${i.ruleId}\` | ${String(i.file).replace(/\|/g, '\\|')} | ${lineRange(i)} |`);
  return [head, ...rows].join('\n');
}

function textTable(items, statusLabel) {
  const head = '  | 状态 | 严重度 | 规则 | 文件 | 旧行号 → 新行号 |\n  |---|---|---|---|---|';
  if (!items.length) return `${head}\n  | ${statusLabel} | — | — | — | — |`;
  const rows = items.map((i) =>
    `  | ${statusLabel} | ${i.severity} | ${i.ruleId} | ${i.file} | ${lineRange(i)} |`);
  return [head, ...rows].join('\n');
}

function buildMarkdown({ opt, sources, rules, comparison, beforeStats, afterStats, summary }) {
  const L = [];
  L.push('# 改前改后复核报告', '');
  L.push('> **声明**：' + DISCLAIMER, '');
  L.push('## 一、复核概览', '');
  L.push(`- 生成时间：${new Date().toISOString()}`);
  L.push(`- 旧快照（改前）：\`${opt.before}\``);
  L.push(`- 新快照（改后）：\`${opt.after}\``);
  L.push(`- 规则源：${sources.length} 个插件 / ${rules.length} 条规则`);
  L.push(`- 扫描文件：旧快照 ${beforeStats.scannedFiles} 个 → 新快照 ${afterStats.scannedFiles} 个`);
  L.push(`- 命中条数：旧快照 ${beforeStats.findings} 条，新快照 ${afterStats.findings} 条`);
  L.push('');
  L.push('**结论摘要**：修复 ' + summary.fixed + ' 项 · 遗留 ' + summary.remaining +
    ' 项 · 新增回归 ' + summary.regressed + ' 项 · 新增文件 ' + summary.newFiles + ' 个。');
  L.push('');
  L.push('## 二、已修复（改前有、改后无）', '');
  L.push(mdTable(comparison.fixed, '✅ 已修复'), '');
  L.push('## 三、遗留（两边都有，还没修掉）', '');
  L.push(mdTable(comparison.remaining, '⚠️ 遗留'), '');
  L.push('## 四、新增回归（改前无、改后有）', '');
  L.push(mdTable(comparison.regressed, '❗ 新增回归'), '');
  L.push('## 五、文件变化', '');
  L.push(`- 新增文件：${comparison.newFiles.length} 个`);
  if (comparison.newFiles.length) L.push(comparison.newFiles.map((f) => '  - `' + f + '`').join('\n'));
  L.push(`- 删除文件：${comparison.removedFiles.length} 个`);
  L.push('');
  L.push('## 六、规则源与扫描范围', '');
  L.push('| 插件 | 短名 | 规则数 | 目录 |');
  L.push('|---|---|---|---|');
  for (const s of sources) L.push(`| ${s.name} | ${s.short} | ${s.rules.length} | \`${s.dir}\` |`);
  L.push('');
  L.push('## 七、复核方式', '');
  L.push('1. 修复后重新运行本命令，确认「遗留」与「新增回归」都归零；');
  L.push('2. 或把 `--json` 输出交给 `dsh-compliance-doc`，生成自查表 / 整改说明 / 合规证明；');
  L.push('3. 行号只作定位参考，比对以「规则 ID + 文件」为准（行号会随代码改动漂移）。');
  L.push('');
  L.push('> ' + DISCLAIMER, '');
  return L.join('\n');
}

function main() {
  const opt = parseArgs(process.argv.slice(2));
  if (opt.help) { usage(); process.exit(0); }

  if (opt.root && (opt.before || opt.after)) die('--root 与 --before/--after 不能同时使用');
  opt.before = opt.root || opt.before;
  opt.after = opt.root || opt.after;
  if (!opt.before) die('缺少 --before（或 --root）参数');
  if (!opt.after) die('缺少 --after 参数（想只对一个目录复核就用 --root）');
  opt.before = resolve(opt.before);
  opt.after = resolve(opt.after);
  if (!isDir(opt.before)) die(`--before 目录不存在：${opt.before}`);
  if (!isDir(opt.after)) die(`--after 目录不存在：${opt.after}`);

  // ── 规则源发现（找不到就失败，绝不假绿）────────────────────────
  const discovery = discoverRuleSources({ pkgRoot: PKG_ROOT, extraDirs: opt.rulesFrom });
  printWarnings(discovery.warnings);
  if (discovery.sources.length === 0) {
    process.stderr.write(zeroSourcesMessage(opt.rulesFrom, discovery));
    process.exit(2);
  }
  const { rules, duplicates } = mergeRules(discovery.sources);
  if (duplicates.length) {
    console.error(`  ⚠️  发现重复规则 ID，已保留首个：${[...new Set(duplicates)].join(', ')}`);
  }
  if (rules.length === 0) {
    process.stderr.write(zeroSourcesMessage(opt.rulesFrom, discovery));
    process.exit(2);
  }

  // ── 同一套规则跑两遍 ───────────────────────────────────────────
  const beforeScan = scan({ root: opt.before, rules, rootLabel: opt.before });
  const afterScan = scan({ root: opt.after, rules, rootLabel: opt.after });
  const beforeFiles = walk(opt.before).files.map((f) => f.path);
  const afterFiles = walk(opt.after).files.map((f) => f.path);
  const comparison = compareFindings({
    beforeFindings: beforeScan.findings,
    afterFindings: afterScan.findings,
    beforeFiles,
    afterFiles,
  });
  const summary = {
    fixed: comparison.fixed.length,
    remaining: comparison.remaining.length,
    regressed: comparison.regressed.length,
    newFiles: comparison.newFiles.length,
    removedFiles: comparison.removedFiles.length,
    beforeFindings: beforeScan.findings.length,
    afterFindings: afterScan.findings.length,
  };
  const code = exitCodeFor(comparison);

  const report = {
    tool: TOOL,
    version: pkg.version,
    generatedAt: new Date().toISOString(),
    before: { root: opt.before, stats: beforeScan.stats },
    after: { root: opt.after, stats: afterScan.stats },
    rules: {
      sources: discovery.sources.map((s) => ({ name: s.name, short: s.short, dir: s.dir, count: s.rules.length })),
      total: rules.length,
    },
    summary,
    fixed: comparison.fixed,
    remaining: comparison.remaining,
    regressed: comparison.regressed,
    newFiles: comparison.newFiles,
    removedFiles: comparison.removedFiles,
    disclaimer: DISCLAIMER,
  };

  if (opt.json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (opt.quiet) {
    console.log(`修复 ${summary.fixed} · 遗留 ${summary.remaining} · 新增回归 ${summary.regressed} · 新增文件 ${summary.newFiles}`);
  } else {
    console.log(`\n  ${TOOL} v${pkg.version} · 改前改后复核`);
    console.log('  ────────────────────────────────────────────────');
    console.log(`  旧快照  ${opt.before}`);
    console.log(`  新快照  ${opt.after}`);
    const srcLine = discovery.sources.map((s) => `${s.short}(${s.rules.length})`).join(' · ');
    console.log(`  规则源  ${discovery.sources.length} 个插件 / ${rules.length} 条规则  [${srcLine}]`);
    console.log(`  扫描    旧 ${beforeScan.stats.scannedFiles} 文件 → 新 ${afterScan.stats.scannedFiles} 文件` +
      ` · 运行规则 ${beforeScan.stats.rulesRun || 0}/${rules.length} · 非文本跳过 ${beforeScan.stats.skippedCount || 0}`);
    console.log('');
    console.log(`  修复 ${summary.fixed} · 遗留 ${summary.remaining} · 新增回归 ${summary.regressed} · 新增文件 ${summary.newFiles}`);
    console.log('');
    console.log('  【已修复】改前有、改后无');
    console.log(textTable(comparison.fixed, '✅已修复'));
    console.log('');
    console.log('  【遗留】两边都有');
    console.log(textTable(comparison.remaining, '⚠️遗留'));
    console.log('');
    console.log('  【新增回归】改前无、改后有');
    console.log(textTable(comparison.regressed, '❗新增回归'));
    console.log('');
    if (comparison.remaining.length || comparison.regressed.length) {
      console.log('  【处理建议】');
      for (const it of [...comparison.remaining, ...comparison.regressed]) {
        console.log(`  · [${it.severity}] ${it.ruleId} @ ${it.file}: ${it.title}`);
        if (it.advice) console.log(`    ${String(it.advice).replace(/\s+/g, ' ').slice(0, 180)}${it.advice.length > 180 ? ' …' : ''}`);
      }
      console.log('');
    }
    console.log('  ────────────────────────────────────────────────');
    console.log(`  结论：${code === 0 ? '遗留与新增回归均已归零 ✅' : '仍有遗留或新增回归，先处理再复核'}`);
    console.log(`  > ${DISCLAIMER}`);
    console.log('');
  }

  if (opt.md) {
    const out = resolve(opt.md);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, buildMarkdown({
      opt,
      sources: discovery.sources,
      rules,
      comparison,
      beforeStats: beforeScan.stats,
      afterStats: afterScan.stats,
      summary,
    }), 'utf-8');
    console.error(`  Markdown 复核报告已写入：${out}`);
  }

  process.exit(code);
}

main();
