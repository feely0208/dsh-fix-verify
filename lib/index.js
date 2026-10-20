import { createPlugin, pkgRootFrom } from '@deepwhale-cn/dsh-guard-core/plugin';

// 「改完到底修没修」—— 同一套规则对改前/改后两份快照各跑一遍，
// 按 ruleId + 文件相对路径比对（不含行号，行号会漂）。
export const { name, inject, apply } = createPlugin({
  name: 'fix-verify',
  pkgRoot: pkgRootFrom(import.meta.url),
  skillFile: 'skill/fix-verify.md',
  binFile: 'bin/cli.mjs',
  description: '改完到底修没修，同一套规则跑两遍给你看',
  whenToUse: '用户改完代码后问「之前那些问题现在还有吗」「这次改动是不是真修掉了」「有没有改出新问题」，' +
    '或者要给出改前/改后的复核证据时使用。典型说法：修完了帮我复核一下、对比改前改后、' +
    '看看还剩几条、这次提交有没有引入新问题。',
});
