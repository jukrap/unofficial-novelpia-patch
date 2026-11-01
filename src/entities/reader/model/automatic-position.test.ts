import { expect, it } from 'vitest';
import { memoryStorage } from '../../../../tests/helpers/storage';
import { AutomaticPositionWriter } from './automatic-position';
import { resumeAnchor, positionKey } from './resume';

const anchor = { episodeId: '1001', blockKey: '80', textOffset: 3, edge: 'text' as const };
it('resumes below 90%, marks completion at the boundary, and leaves manual bookmarks alone', async () => {
  const db = memoryStorage();
  const writer = new AutomaticPositionWriter(db.port.local);
  await db.port.local.set({ 'unp.bookmark.v1.1001': anchor });
  await writer.write(anchor, 0.899);
  expect(resumeAnchor('1001', db.localData[positionKey('1001')])).toEqual(anchor);
  await writer.write(anchor, 0.9);
  expect(db.localData[positionKey('1001')]).toEqual({ episodeId: '1001', completed: true });
  expect(resumeAnchor('1001', db.localData[positionKey('1001')])).toBeNull();
  expect(resumeAnchor('1001', anchor, db.localData[positionKey('1001')])).toEqual(anchor);
  expect(db.localData['unp.bookmark.v1.1001']).toEqual(anchor);
});
it('serializes competing tabs and keeps completion after a worker restart', async () => {
  const db = memoryStorage();
  const writer = new AutomaticPositionWriter(db.port.local);
  await Promise.all([writer.write(anchor, 0.95), writer.write({ ...anchor, blockKey: '30' }, 0.3)]);
  await new AutomaticPositionWriter(db.port.local).write(anchor, 0.5);
  expect(db.localData[positionKey('1001')]).toEqual({ episodeId: '1001', completed: true });
});
it('can finish a service-only final page without inventing a text anchor', async () => {
  const db = memoryStorage();
  const writer = new AutomaticPositionWriter(db.port.local);
  await expect(writer.write({ episodeId: '1001' }, 0.5)).rejects.toThrow();
  await writer.write({ episodeId: '1001' }, 1);
  expect(db.localData[positionKey('1001')]).toEqual({ episodeId: '1001', completed: true });
  await expect(writer.write({ episodeId: '../1001' }, 1)).rejects.toThrow();
});
it('rejects damaged progress without replacing the previous position', async () => {
  const db = memoryStorage();
  const writer = new AutomaticPositionWriter(db.port.local);
  await writer.write(anchor, 0.4);
  for (const progress of [NaN, Infinity, -0.1, 1.1, '0.9'])
    await expect(writer.write(anchor, progress)).rejects.toThrow();
  expect(db.localData[positionKey('1001')]).toEqual(anchor);
});

it('keeps the previous anchor when saving completion fails and permits a later retry', async () => {
  const db = memoryStorage();
  await db.port.local.set({ [positionKey('1001')]: anchor });
  let fail = true;
  const writer = new AutomaticPositionWriter({
    ...db.port.local,
    async set(items) {
      if (fail) throw new Error('Storage unavailable');
      await db.port.local.set(items);
    },
  });
  await expect(writer.write(anchor, 0.95)).rejects.toThrow('Storage unavailable');
  expect(db.localData[positionKey('1001')]).toEqual(anchor);
  fail = false;
  await expect(writer.write(anchor, 0.95)).resolves.toBe(true);
  expect(db.localData[positionKey('1001')]).toEqual({ episodeId: '1001', completed: true });
});
