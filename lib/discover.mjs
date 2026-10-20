/**
 * 规则源发现器 —— dsh-fix-verify 自带一份。
 *
 * 为什么每个工具插件都带一份、而不是互相 import：
 * 每个插件要能**独立安装**。用户只装了 dsh-fix-verify 时，它得自己找到
 * 已经装好的规则插件；不能因为「另一个工具插件没装」而直接报错。
 *
 * 搜索顺序（先到先得，同一目录按 realpath 去重）：
 *   1) 显式传入的 extraDirs（--rules-from）
 *   2) <pkgRoot>/node_modules/@deepwhale-cn/dsh-<插件名>/rules
 *   3) <dirname(pkgRoot)>/dsh-<插件名>/rules（插件并排安装 / monorepo 开发时）
 *   4) 环境变量 DSH_GUARD_PLUGINS（冒号分隔）
 *
 * 只接受「含 rules/*.json 且至少 1 条合法规则」的目录。
 * 每条规则注入 `_plugin`（目录名去掉 dsh- 前缀），用于在报告里标明出处。
 *
 * 找不到规则源时，调用方必须 **报错退出**，绝不允许把「没检查」当成「0 命中」。
 */

import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const SCOPE = '@deepwhale-cn';

function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

function real(p) {
  try { return realpathSync(p); } catch { return resolve(p); }
}

/** 目录名 dsh-sbom -> short 名 sbom */
function shortOf(dir) {
  const n = basename(dir);
  return n.startsWith('dsh-') ? n.slice(4) : n;
}

/**
 * 读一个插件根目录下的 rules/*.json。
 * 单个文件坏掉只跳过并记 warning —— 不能让一条坏规则把整个工具搞挂，
 * 但也不能假装它不存在：warning 会打到 stderr。
 */
function loadRulesFrom(root, warnings) {
  const rdir = join(root, 'rules');
  let files;
  try {
    files = readdirSync(rdir).filter((f) => f.endsWith('.json')).sort();
  } catch {
    return [];
  }
  const rules = [];
  for (const f of files) {
    const full = join(rdir, f);
    let raw;
    try {
      raw = JSON.parse(readFileSync(full, 'utf-8'));
    } catch (e) {
      warnings.push(`规则文件无法解析，已跳过：${full}（${e && e.message}）`);
      continue;
    }
    if (!raw || typeof raw !== 'object' || !raw.id || !raw.check) {
      warnings.push(`规则文件缺 id/check，已跳过：${full}`);
      continue;
    }
    rules.push(raw);
  }
  return rules;
}

function childDirs(parent) {
  try {
    return readdirSync(parent, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join(parent, e.name));
  } catch {
    return [];
  }
}

/**
 * @param {object} o
 * @param {string} o.pkgRoot              本插件根目录（绝对路径）
 * @param {string[]} [o.extraDirs]        --rules-from 传入的目录（可重复）
 * @param {NodeJS.ProcessEnv} [o.env]     用于读 DSH_GUARD_PLUGINS
 * @returns {{sources: Array<{name:string,short:string,dir:string,rules:Array}>, warnings:string[], candidates:Array}}
 */
export function discoverRuleSources({ pkgRoot, extraDirs = [], env = process.env } = {}) {
  const warnings = [];
  const sources = [];
  const candidates = [];
  const seenRoots = new Set();
  const seenCandidates = new Set();
  const pkgReal = pkgRoot ? real(pkgRoot) : null;

  function consider(pluginDir, via) {
    if (!isDir(pluginDir)) return;
    const rr = real(pluginDir);
    if (pkgReal && rr === pkgReal) return; // 自己是工具插件，没有规则，也算不上来源
    const rules = loadRulesFrom(rr, warnings);
    if (!seenCandidates.has(rr)) {
      seenCandidates.add(rr);
      candidates.push({ name: basename(rr), short: shortOf(rr), dir: rr, rules: rules.length, via });
    }
    if (rules.length === 0) return;
    if (seenRoots.has(rr)) return;
    seenRoots.add(rr);
    const short = shortOf(rr);
    for (const r of rules) r._plugin = short;
    sources.push({ name: basename(rr), short, dir: rr, rules });
  }

  /** extraDirs / env：可以是插件根，也可以是「装着多个插件的父目录」 */
  function considerCandidateDir(dir, via) {
    if (!dir) return;
    const d = resolve(String(dir));
    if (!isDir(d)) {
      warnings.push(`规则源目录不存在或不是目录（已跳过）：${d}`);
      return;
    }
    if (isDir(join(d, 'rules'))) {
      consider(d, via);
      return;
    }
    let hit = false;
    for (const child of childDirs(d)) {
      if (isDir(join(child, 'rules'))) {
        consider(child, via);
        hit = true;
      }
    }
    if (!hit) warnings.push(`目录里没有可用规则源（未找到 dsh-*/rules）：${d}`);
  }

  // 1) 显式指定
  for (const d of extraDirs || []) considerCandidateDir(d, 'extra');

  if (pkgRoot) {
    // 2) 当前插件自己的 node_modules（项目本地安装的守护插件）
    const scopeDir = join(pkgRoot, 'node_modules', SCOPE);
    for (const child of childDirs(scopeDir)) {
      if (basename(child).startsWith('dsh-')) consider(child, 'node_modules');
    }

    // 3) 与当前插件并排安装的守护插件
    for (const child of childDirs(dirname(pkgRoot))) {
      if (basename(child).startsWith('dsh-')) consider(child, 'sibling');
    }
  }

  // 4) 环境变量
  const envVal = env && env.DSH_GUARD_PLUGINS;
  if (envVal) {
    for (const p of String(envVal).split(':').filter(Boolean)) considerCandidateDir(p, 'env');
  }

  return { sources, warnings, candidates };
}
