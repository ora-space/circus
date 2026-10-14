import type { Event } from '../handle.ts';
import type { GitHub } from '../github.ts';
import type { Board } from '../../lib/board.ts';
import type { NotificationConfig } from './config.ts';
import type { Sender } from './feishu.ts';
import type { Pull } from './rules.ts';
import { memoryStore, flush } from './store.ts';
import { observeHandle, snapshot } from './observe.ts';

// Notification failures never replay or roll back the business operation.
export async function deliverEvent(
  event: Event, gh: GitHub, repo: string, config: NotificationConfig, sender: Sender,
  report: (message: string) => void, board?: Board, pulls?: (n: number) => Pull[],
): Promise<void> {
  const store = memoryStore();
  let businessFailure: unknown;
  try {
    observeHandle(event, gh, repo, store, config, board, pulls,
      () => report('通知状态采集失败，本次通知跳过；不影响 GitHub 业务操作'));
  } catch (e) { businessFailure = e; }
  try {
    const result = await flush(store, config, sender, n => snapshot(gh, repo, n, pulls), report);
    if (result.failed) report(`本次 ${result.failed} 项通知未送达，不进行跨运行补发`);
  } catch {
    report('通知发送失败，本次通知跳过；不进行跨运行补发');
  }
  if (businessFailure) throw businessFailure;
}
