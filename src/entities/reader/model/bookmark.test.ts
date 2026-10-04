import { describe, expect, it, vi } from 'vitest';
import { memoryStorage } from '../../../../tests/helpers/storage';
import { BookmarkStore } from './bookmark';
import type { ReadingAnchor } from './anchor';

const anchor: ReadingAnchor = { episodeId: '1001', blockKey: '8', textOffset: 42, edge: 'text' };
const key = 'unp.bookmark.v1.1001';
describe('content bookmarks', () => {
  it('persists an episode-scoped content position and receives other-tab saves', async () => {
    const db = memoryStorage();
    const legacy = { read: () => '4', clear: vi.fn() };
    const first = new BookmarkStore('1001', db.port, legacy);
    const second = new BookmarkStore('1001', db.port, legacy);
    await first.initialize();
    await second.initialize();
    expect(first.getSnapshot()).toMatchObject({ ready: true, legacy: 4, anchor: null });
    await first.save(anchor);
    expect(db.localData[key]).toEqual(anchor);
    expect(db.syncData).toEqual({});
    expect(second.getSnapshot().anchor).toEqual(anchor);
    first.dispose();
    const reopened = new BookmarkStore('1001', db.port, legacy);
    await reopened.initialize();
    expect(reopened.getSnapshot().anchor).toEqual(anchor);
    await reopened.clear();
    expect(db.localData[key]).toBeUndefined();
    expect(legacy.clear).toHaveBeenCalledOnce();
    expect(reopened.getSnapshot()).toMatchObject({ anchor: null, legacy: null, error: '' });
    second.dispose();
    reopened.dispose();
  });

  it('rejects another episode or invalid offsets without overwriting a saved bookmark', async () => {
    const db = memoryStorage();
    const store = new BookmarkStore('1001', db.port, { read: () => 'NaN', clear() {} });
    await store.initialize();
    await store.save(anchor);
    for (const invalid of [{ ...anchor, episodeId: '1002' }, { ...anchor, textOffset: -1 }, null]) {
      await store.save(invalid);
      expect(db.localData[key]).toEqual(anchor);
      expect(store.getSnapshot().error).not.toBe('');
    }
    expect(store.getSnapshot().legacy).toBeNull();
    store.dispose();
  });

  it('reports a failed write while keeping the previous bookmark available', async () => {
    const db = memoryStorage();
    const store = new BookmarkStore('1001', db.port, { read: () => null, clear() {} });
    await store.initialize();
    await store.save(anchor);
    db.port.local.set = async () => {
      throw new Error('storage unavailable');
    };
    await store.save({ ...anchor, blockKey: '9' });
    expect(store.getSnapshot().anchor).toEqual(anchor);
    expect(store.getSnapshot().error).toContain('저장하지 못');
    store.dispose();
  });
});
