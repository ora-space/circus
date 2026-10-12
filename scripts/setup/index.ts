import type { Command } from '../lib/context.ts';
import { allLabels } from '../lib/labels.ts';

const usage = `setup
    owner 用（幂等）：按 label 登记表创建或校正仓库里的 label，需要写权限。看板由 bot 自己维护，不在这里。`;

export const command: Command = {
  usage,
  run(_args, ctx) {
    const labels = allLabels();
    for (const l of labels) {
      ctx.gh(['label', 'create', l.name, '-R', ctx.repo, '--color', l.color, '--description', l.description, '--force']);
    }
    ctx.out(`labels ok (${labels.length})`);
  },
};
