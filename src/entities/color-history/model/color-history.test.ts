import { describe, expect, it } from 'vitest';
import { memoryStorage } from '../../../../tests/helpers/storage';
import { ColorHistory, recentColors, RECENT_COLORS_KEY } from './color-history';
describe('recent color history', () => {
  it('validates, deduplicates case-insensitively, and keeps the twelve most recent choices', () => {
    expect(recentColors(['#abcdef', '#ABCDEF', 'red', null, '#123456'])).toEqual([
      '#ABCDEF',
      '#123456',
    ]);
    expect(
      recentColors(Array.from({ length: 20 }, (_, n) => `#${n.toString(16).padStart(6, '0')}`))
    ).toHaveLength(12);
  });
  it('persists explicit selections locally and shares changes without recording every slider frame', async () => {
    const db = memoryStorage();
    const first = new ColorHistory(db.port),
      second = new ColorHistory(db.port);
    const stop1 = first.subscribe(() => {}),
      stop2 = second.subscribe(() => {});
    await first.remember('#123456');
    await second.remember('#abcdef');
    await first.remember('#123456');
    expect(second.getSnapshot()).toEqual(['#123456', '#ABCDEF']);
    expect(db.localData[RECENT_COLORS_KEY]).toEqual(second.getSnapshot());
    expect(db.syncData).toEqual({});
    stop1();
    stop2();
  });
});
