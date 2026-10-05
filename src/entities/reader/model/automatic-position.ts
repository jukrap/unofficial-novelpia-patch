import type { StorageArea } from '@/shared/platform/storage';
import { parseAnchor, type ReadingAnchor } from './anchor';
import { completedPosition, positionKey } from './resume';

export const POSITION_MESSAGE = 'unp:automatic-position';
export type AutomaticPosition = ReadingAnchor | { episodeId: string };
export function positionEpisode(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('episodeId' in value)) return null;
  return typeof value.episodeId === 'string' && /^\d+$/.test(value.episodeId)
    ? value.episodeId
    : null;
}

/** The background serializes all tabs, so a late partial report cannot undo completion. */
export class AutomaticPositionWriter {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private local: StorageArea) {}
  write(value: unknown, progress: unknown): Promise<boolean> {
    const anchor = parseAnchor(value);
    const episodeId = positionEpisode(value);
    if (
      !episodeId ||
      typeof progress !== 'number' ||
      !Number.isFinite(progress) ||
      progress < 0 ||
      progress > 1 ||
      (progress < 0.9 && !anchor)
    )
      return Promise.reject(new Error('읽기 위치를 확인해 주세요.'));
    const task = this.queue.then(async () => {
      const key = positionKey(episodeId);
      const existing = (await this.local.get(key))[key];
      if (completedPosition(existing, episodeId)) return true;
      const completed = progress >= 0.9;
      await this.local.set({
        [key]: completed
          ? { episodeId, completed: true }
          : {
              episodeId,
              blockKey: anchor!.blockKey,
              textOffset: anchor!.textOffset,
              edge: anchor!.edge,
            },
      });
      return completed;
    });
    this.queue = task.catch(() => {});
    return task;
  }
}
