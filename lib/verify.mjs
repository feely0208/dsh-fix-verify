/**
 * 改前改后比对逻辑 —— 与 CLI 分离，方便测试和复用。
 *
 * 比对键刻意**不含行号**：用户修完代码，行号几乎必然漂移
 * （加了一行注释，"第 12 行"就变成了"第 13 行"）。
 * 用「规则 ID + 文件相对路径」才回答得了真正的问题：
 * 「改之前这个文件里的这条问题，现在还报不报？」
 */

const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * 把 findings 按 ruleId + file 归并。
 * 同一规则在同一文件里命中多行时，合成一条，保留行号列表与命中数。
 */
export function indexFindings(findings) {
  const map = new Map();
  for (const f of findings || []) {
    const ruleId = f.ruleId || '(未知规则)';
    const file = f.file || '(全局)';
    const key = `${ruleId}\u0000${file}`;
    let e = map.get(key);
    if (!e) {
      e = {
        key,
        ruleId,
        file,
        title: f.title || '',
        severity: f.severity || 'medium',
        source: f.source || '',
        advice: f.advice || '',
        lines: [],
        evidence: [],
      };
      map.set(key, e);
    }
    if (Number.isFinite(Number(f.line)) && Number(f.line) > 0) e.lines.push(Number(f.line));
    if (f.evidence && e.evidence.length < 3) e.evidence.push(String(f.evidence).slice(0, 160));
  }
  for (const e of map.values()) {
    e.lines.sort((a, b) => a - b);
    e.line = e.lines.length ? e.lines[0] : 0;
    e.count = e.lines.length || 1;
  }
  return map;
}

function sortItems(arr) {
  return arr.sort((a, b) =>
    (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9) ||
    String(a.ruleId).localeCompare(String(b.ruleId)) ||
    String(a.file).localeCompare(String(b.file)));
}

function baseItem(e) {
  return {
    ruleId: e.ruleId,
    title: e.title,
    severity: e.severity,
    source: e.source,
    advice: e.advice,
    file: e.file,
    evidence: e.evidence,
  };
}

/**
 * 四个桶：
 *   fixed     —— 改前有、改后没有（真修掉了）
 *   remaining —— 两边都有（没修掉 / 还没轮到）
 *   regressed —— 改前没有、改后有（改出新问题）
 *   newFiles  —— 改后新增的文件（只做统计，不参与问题判定）
 */
export function compareFindings({ beforeFindings = [], afterFindings = [], beforeFiles = [], afterFiles = [] }) {
  const before = indexFindings(beforeFindings);
  const after = indexFindings(afterFindings);

  const fixed = [];
  const remaining = [];
  const regressed = [];

  for (const [key, e] of before) {
    if (after.has(key)) {
      const a = after.get(key);
      remaining.push({
        ...baseItem(e),
        beforeLine: e.line,
        afterLine: a.line,
        beforeCount: e.count,
        afterCount: a.count,
      });
    } else {
      fixed.push({
        ...baseItem(e),
        beforeLine: e.line,
        afterLine: null,
        beforeCount: e.count,
      });
    }
  }
  for (const [key, e] of after) {
    if (before.has(key)) continue;
    regressed.push({
      ...baseItem(e),
      beforeLine: null,
      afterLine: e.line,
      afterCount: e.count,
    });
  }

  const beforeSet = new Set(beforeFiles);
  const afterSet = new Set(afterFiles);
  const newFiles = afterFiles.filter((f) => !beforeSet.has(f)).sort();
  const removedFiles = beforeFiles.filter((f) => !afterSet.has(f)).sort();

  sortItems(fixed);
  sortItems(remaining);
  sortItems(regressed);

  return { fixed, remaining, regressed, newFiles, removedFiles };
}

/** 退出码语义：还有遗留或回归就是 1；都清零才 0 */
export function exitCodeFor({ remaining, regressed }) {
  return (remaining.length === 0 && regressed.length === 0) ? 0 : 1;
}

export function severityRank(s) {
  return SEV_ORDER[s] ?? 9;
}
