import { afterEach, expect, it, vi } from 'vitest';
import { POSITION_MESSAGE } from '@/entities/reader';
import { memoryStorage } from '../../../tests/helpers/storage';
import { installReadingPositionService } from './reading-position-service';

afterEach(() => vi.unstubAllGlobals());
const anchor = { episodeId: '74928', blockKey: '80', textOffset: 3, edge: 'text' };
function setup() {
  const db = memoryStorage();
  const addListener = vi.fn();
  vi.stubGlobal('chrome', { runtime: { id: 'reader-test', onMessage: { addListener } } });
  installReadingPositionService(db.port.local);
  const listener = addListener.mock.calls[0]![0];
  const request = (url: string, patch: Partial<chrome.runtime.MessageSender> = {}) =>
    new Promise<Record<string, unknown>>((resolve) =>
      listener(
        { type: POSITION_MESSAGE, anchor, progress: 0.3 },
        { id: 'reader-test', url, frameId: 0, ...patch },
        resolve
      )
    );
  return { db, request };
}

it.each([
  'https://novelpia.com/viewer/74928',
  'https://novelpia.com/viewer/74928/',
  'https://www.novelpia.com/viewer/74928/?from=list#reader',
])('saves the same episode from its valid viewer URL %s', async (url) => {
  const { db, request } = setup();
  expect(await request(url)).toMatchObject({ ok: true, completed: false });
  expect(db.localData['unp.position.v1.74928']).toEqual(anchor);
});

it.each([
  'https://novelpia.com/viewer/74929/',
  'https://novelpia.com/viewer/74928/extra',
  'https://novelpia.com.evil.test/viewer/74928/',
  'http://novelpia.com/viewer/74928/',
  'chrome-extension://reader-test/options.html',
])('rejects unrelated sender URL %s without writing', async (url) => {
  const { db, request } = setup();
  expect(await request(url)).toMatchObject({ ok: false });
  expect(db.localData).toEqual({});
});

it('rejects another extension and a child frame', async () => {
  const { db, request } = setup();
  expect(await request('https://novelpia.com/viewer/74928', { id: 'other' })).toMatchObject({
    ok: false,
  });
  expect(await request('https://novelpia.com/viewer/74928', { frameId: 1 })).toMatchObject({
    ok: false,
  });
  expect(db.localData).toEqual({});
});

it('reports a real storage failure without changing the previous anchor and accepts a retry', async () => {
  const { db, request } = setup();
  db.localData['unp.position.v1.74928'] = { ...anchor, blockKey: '20' };
  vi.spyOn(db.port.local, 'set').mockRejectedValueOnce(new Error('Storage unavailable'));
  expect(await request('https://novelpia.com/viewer/74928/')).toEqual({
    ok: false,
    error: 'Storage unavailable',
  });
  expect(db.localData['unp.position.v1.74928']).toMatchObject({ blockKey: '20' });
  expect(await request('https://novelpia.com/viewer/74928/')).toMatchObject({ ok: true });
  expect(db.localData['unp.position.v1.74928']).toEqual(anchor);
});
