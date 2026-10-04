import { afterEach, describe, it, expect, vi } from 'vitest';
import { SettingsStore, SETTINGS_KEY } from './store';
import { defaults } from '@/shared/model/preferences';
import { memoryStorage } from '../../../../tests/helpers/storage';
import { DEFAULT_SETTINGS } from '@/shared/config/base-settings';
afterEach(() => vi.useRealTimers());
describe('settings migration and persistence', () => {
  it('keeps saved typography and placement while filling the new paragraph control with the new default', async () => {
    const previous = {
      ...defaults,
      ...DEFAULT_SETTINGS,
      pageNavigationPlacement: 'reserved',
    } as Record<string, unknown>;
    delete previous.paragraphGap;
    const document = { schemaVersion: 1, data: previous };
    const db = memoryStorage({ [SETTINGS_KEY]: document });
    const store = new SettingsStore(db.port);
    await store.initialize();
    expect(store.getSnapshot().settings).toMatchObject({
      fontFamily: 'system-ui',
      lineHeight: 160,
      maxWidth: 875,
      horizontalPadding: 20,
      paragraphSpacing: 8,
      paragraphGap: 1,
      pageNavigationPlacement: 'reserved',
    });
    expect(db.syncData[SETTINGS_KEY]).toEqual(document);
    store.update({ paragraphGap: 24 });
    await store.flush();
    store.update({ paragraphGap: -1 });
    expect(store.getSnapshot().settings.paragraphGap).toBe(24);
    store.update({ paragraphGap: 101 });
    expect(store.getSnapshot().settings.paragraphGap).toBe(24);
    expect(db.syncData[SETTINGS_KEY]).toMatchObject({ data: { ...previous, paragraphGap: 24 } });
    store.dispose();
  });
  it('fills new page-layout defaults for an existing document and persists valid choices only', async () => {
    const legacy = Object.fromEntries(
      Object.entries(defaults).filter(
        ([key]) =>
          ![
            'pageGap',
            'pageNavigationPlacement',
            'readerHeightPercent',
            'readingSurfaces',
          ].includes(key)
      )
    );
    const db = memoryStorage({
      [SETTINGS_KEY]: { schemaVersion: 1, data: { ...legacy, fontSize: 23 } },
    });
    const store = new SettingsStore(db.port);
    await store.initialize();
    expect(store.getSnapshot().settings).toMatchObject({
      fontSize: 23,
      pageGap: 20,
      pageNavigationPlacement: defaults.pageNavigationPlacement,
      readerHeightPercent: 100,
      readingSurfaces: 'theme',
    });
    expect(db.syncData[SETTINGS_KEY]).toEqual({
      schemaVersion: 1,
      data: { ...legacy, fontSize: 23 },
    });
    store.update({
      pageGap: 400,
      pageNavigationPlacement: 'fixed',
      readerHeightPercent: 60,
      readingSurfaces: 'theme',
    });
    await store.flush();
    store.update({ pageGap: 401 });
    expect(store.getSnapshot().settings.pageGap).toBe(400);
    store.update({ pageGap: -1 });
    expect(store.getSnapshot().settings.pageGap).toBe(400);
    for (const readerHeightPercent of [0, 39, 101]) {
      store.update({ readerHeightPercent });
      expect(store.getSnapshot().settings.readerHeightPercent).toBe(60);
    }
    store.update({ pageGap: 0 });
    await store.flush();
    const restored = new SettingsStore(db.port);
    await restored.initialize();
    expect(restored.getSnapshot().settings).toMatchObject({
      fontSize: 23,
      pageGap: 0,
      pageNavigationPlacement: 'fixed',
      readerHeightPercent: 60,
      readingSurfaces: 'theme',
    });
    store.dispose();
    restored.dispose();
  });
  it('catches an external write between the initial read and listener installation', async () => {
    const db = memoryStorage({ [SETTINGS_KEY]: { schemaVersion: 1, data: defaults } });
    const get = db.port.sync.get;
    let first = true;
    db.port.sync.get = async (keys) => {
      const raw = await get(keys);
      if (first) {
        first = false;
        await db.port.sync.set({
          [SETTINGS_KEY]: { schemaVersion: 1, data: { ...defaults, fontSize: 28 } },
        });
      }
      return raw;
    };
    const store = new SettingsStore(db.port);
    await store.initialize();
    expect(store.getSnapshot().settings.fontSize).toBe(28);
    store.dispose();
  });

  it('does not replace a newer notification with the stale catch-up read', async () => {
    const db = memoryStorage({ [SETTINGS_KEY]: { schemaVersion: 1, data: defaults } });
    const get = db.port.sync.get;
    let notified = false;
    db.port.sync.get = async (keys) => {
      const raw = await get(keys);
      if (keys === SETTINGS_KEY && !notified) {
        notified = true;
        await db.port.sync.set({
          [SETTINGS_KEY]: { schemaVersion: 1, data: { ...defaults, fontSize: 32 } },
        });
      }
      return raw;
    };
    const store = new SettingsStore(db.port);
    await store.initialize();
    expect(notified).toBe(true);
    expect(store.getSnapshot().settings.fontSize).toBe(32);
    store.dispose();
  });

  it('keeps local edits made while the catch-up read is pending', async () => {
    vi.useFakeTimers();
    const db = memoryStorage({ [SETTINGS_KEY]: { schemaVersion: 1, data: defaults } });
    const get = db.port.sync.get;
    const store = new SettingsStore(db.port);
    db.port.sync.get = async (keys) => {
      const raw = await get(keys);
      if (keys === SETTINGS_KEY) {
        store.update({ fontSize: 33 });
        await db.port.sync.set({
          [SETTINGS_KEY]: { schemaVersion: 1, data: { ...defaults, fontSize: 21 } },
        });
      }
      return raw;
    };
    await store.initialize();
    expect(store.getSnapshot()).toMatchObject({ settings: { fontSize: 33 }, status: 'saving' });
    await store.flush();
    expect(db.syncData[SETTINGS_KEY]).toMatchObject({ data: { fontSize: 33 } });
    store.dispose();
  });

  it('protects a future schema received during catch-up even when there is a local edit', async () => {
    vi.useFakeTimers();
    const db = memoryStorage({ [SETTINGS_KEY]: { schemaVersion: 1, data: defaults } });
    const get = db.port.sync.get;
    const store = new SettingsStore(db.port);
    const future = { schemaVersion: 99, data: { fontSize: 49 } };
    db.port.sync.get = async (keys) => {
      const raw = await get(keys);
      if (keys === SETTINGS_KEY) {
        store.update({ fontSize: 33 });
        await db.port.sync.set({ [SETTINGS_KEY]: future });
      }
      return raw;
    };
    await store.initialize();
    expect(store.getSnapshot().status).toBe('error');
    store.update({ fontSize: 22 });
    await store.flush();
    expect(db.syncData[SETTINGS_KEY]).toEqual(future);
    store.dispose();
  });

  it('verifies Chrome storage data independently of object key order', async () => {
    const db = memoryStorage();
    const get = db.port.sync.get;
    db.port.sync.get = async (keys) => {
      const raw = await get(keys);
      const doc = raw[SETTINGS_KEY] as
        | { schemaVersion: number; data: Record<string, unknown> }
        | undefined;
      if (doc)
        raw[SETTINGS_KEY] = {
          data: Object.fromEntries(Object.entries(doc.data).reverse()),
          schemaVersion: doc.schemaVersion,
        };
      return raw;
    };
    const store = new SettingsStore(db.port);
    await store.initialize();
    expect(store.getSnapshot().status).toBe('saved');
    expect(db.localData['unp.migration.settings.complete.v1']).toBe(true);
    store.dispose();
  });
  it('merges only valid v4 fields over legacy and never migrates consent', async () => {
    const db = memoryStorage({
      novolpiaPatchSettings: { fontSize: 24, fontFamily: 'unknown family', autoRecommend: true },
      'unp.settings.v4': { fontSize: 'bad', horizontalPadding: 35, autoRecommend: true },
    });
    const store = new SettingsStore(db.port);
    await store.initialize();
    expect(store.getSnapshot().settings).toMatchObject({
      fontSize: 24,
      horizontalPadding: 35,
      fontFamily: 'unknown family',
      autoRecommend: false,
    });
    expect(store.getSnapshot().migrationIssues).toContain('fontSize');
    expect(db.localData['unp.migration.settings.complete.v1']).toBe(true);
    expect(db.syncData.novolpiaPatchSettings).toMatchObject({ autoRecommend: true });
    store.dispose();
  });
  it('refuses to overwrite a future schema', async () => {
    const future = { schemaVersion: 99, data: { fontSize: 49 } };
    const db = memoryStorage({ [SETTINGS_KEY]: future });
    const store = new SettingsStore(db.port);
    await store.initialize();
    store.update({ fontSize: 18 });
    await store.flush();
    expect(db.syncData[SETTINGS_KEY]).toEqual(future);
    expect(store.getSnapshot().status).toBe('error');
    store.dispose();
  });
  it('coalesces edits, exposes quota errors, keeps local recovery and retries', async () => {
    vi.useFakeTimers();
    const db = memoryStorage({ [SETTINGS_KEY]: { schemaVersion: 1, data: defaults } });
    const store = new SettingsStore(db.port);
    await store.initialize();
    store.update({ fontSize: 20 });
    store.update({ fontSize: 25 });
    db.fail();
    await vi.advanceTimersByTimeAsync(210);
    expect(store.getSnapshot().status).toBe('error');
    expect(db.localData['unp.settings.recovery.v1']).toMatchObject({ fontSize: 25 });
    db.fail(false);
    await store.flush();
    expect(store.getSnapshot().status).toBe('saved');
    expect(db.syncData[SETTINGS_KEY]).toMatchObject({ data: { fontSize: 25 } });
    store.dispose();
  });
  it('retains unsaved settings after a failed save when another context changes storage', async () => {
    vi.useFakeTimers();
    const db = memoryStorage({ [SETTINGS_KEY]: { schemaVersion: 1, data: defaults } });
    const store = new SettingsStore(db.port);
    await store.initialize();
    store.update({ fontSize: 31 });
    db.fail();
    await store.flush();
    expect(store.getSnapshot().status).toBe('error');
    db.fail(false);
    await db.port.sync.set({
      [SETTINGS_KEY]: { schemaVersion: 1, data: { ...defaults, fontSize: 24 } },
    });
    expect(store.getSnapshot()).toMatchObject({ settings: { fontSize: 31 }, status: 'error' });
    await store.flush();
    expect(db.syncData[SETTINGS_KEY]).toMatchObject({ data: { fontSize: 31 } });
    store.dispose();
  });
  it('does not apply malformed values and receives other-context changes', async () => {
    const db = memoryStorage();
    const a = new SettingsStore(db.port);
    const b = new SettingsStore(db.port);
    await a.initialize();
    await b.initialize();
    a.update({ fontSize: Infinity });
    expect(a.getSnapshot().settings.fontSize).toBe(18);
    a.update({ fontSize: 28 });
    await a.flush();
    expect(b.getSnapshot().settings.fontSize).toBe(28);
    a.dispose();
    b.dispose();
  });
});
