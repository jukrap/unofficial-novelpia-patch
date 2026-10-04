import { expect, it } from 'vitest';
import { SettingsStore, SETTINGS_KEY } from '@/entities/settings';
import { defaults, applyPresetSettings } from '@/shared/model/preferences';
import { memoryStorage } from '../../../../tests/helpers/storage';
import { STARTUP_KEY, startupTheme } from '@/shared/platform/startup';

it('keeps legacy visual settings and waits for native animation preference only on upgrade', async () => {
  const {
    pageEffect: _effect,
    backgroundAssetId: _id,
    backgroundImageSource: _source,
    backgroundImageFade: _fade,
    ...legacy
  } = defaults;
  const db = memoryStorage({
    [SETTINGS_KEY]: { schemaVersion: 1, data: { ...legacy, fontSize: 29 } },
  });
  const store = new SettingsStore(db.port);
  await store.initialize();
  expect(store.getSnapshot()).toMatchObject({
    needsEffectMigration: true,
    settings: { fontSize: 29, backgroundImageSource: 'url', backgroundAssetId: null },
  });
  store.update({ pageEffect: 'none' });
  await store.flush();
  expect(store.getSnapshot().needsEffectMigration).toBe(false);
  expect(db.syncData[SETTINGS_KEY]).toMatchObject({ data: { pageEffect: 'none', fontSize: 29 } });
  store.dispose();
  const fresh = new SettingsStore(memoryStorage().port);
  await fresh.initialize();
  expect(fresh.getSnapshot()).toMatchObject({
    needsEffectMigration: false,
    settings: { pageEffect: 'slide' },
  });
  fresh.dispose();
});

it('caches only durable theme changes and does not replace the cache after a failed save', async () => {
  const db = memoryStorage({ [SETTINGS_KEY]: { schemaVersion: 1, data: defaults } });
  const store = new SettingsStore(db.port);
  await store.initialize();
  store.update({ backgroundColor: '#123456', enabled: false });
  await store.flush();
  expect(startupTheme(db.localData[STARTUP_KEY])).toMatchObject({
    backgroundColor: '#123456',
    enabled: false,
  });
  db.fail();
  store.update({ backgroundColor: '#fedcba', enabled: true });
  await store.flush();
  expect(startupTheme(db.localData[STARTUP_KEY])).toMatchObject({
    backgroundColor: '#123456',
    enabled: false,
  });
  expect(store.getSnapshot().status).toBe('error');
  store.dispose();
});

it('rejects malformed cached CSS and keeps motion preferences outside preset application', () => {
  expect(startupTheme({ ...defaults, backgroundColor: 'red;display:none' })).toBeNull();
  const next = applyPresetSettings(
    { ...defaults, pageEffect: 'none', backgroundImageFade: false },
    {
      ...defaults,
      pageEffect: 'fold',
      backgroundImageFade: true,
      backgroundImageSource: 'file',
      backgroundAssetId: 'image-id',
    }
  );
  expect(next).toMatchObject({
    pageEffect: 'none',
    backgroundImageFade: false,
    backgroundImageSource: 'file',
    backgroundAssetId: 'image-id',
  });
});

it('reads the old startup palette without new fields and validates optional paint values', () => {
  const legacy = {
    enabled: true,
    darkMode: false,
    backgroundColor: '#123456',
    textColor: '#abcdef',
    textAreaBackgroundColor: '#334455',
  };
  expect(startupTheme(legacy)).toEqual({
    ...legacy,
    textAreaOpacity: 100,
    readingSurfaces: 'default',
  });
  expect(startupTheme({ ...legacy, textAreaOpacity: 45, readingSurfaces: 'theme' })).toMatchObject({
    textAreaOpacity: 45,
    readingSurfaces: 'theme',
  });
  expect(
    startupTheme({ ...legacy, textAreaOpacity: NaN, readingSurfaces: 'red;display:none' })
  ).toMatchObject({ textAreaOpacity: 100, readingSurfaces: 'default' });
});

it('keeps pending animation migration through legacy import and settings-page edits', async () => {
  const db = memoryStorage({ novolpiaPatchSettings: { fontSize: 26 } });
  const options = new SettingsStore(db.port);
  await options.initialize();
  expect(options.getSnapshot().needsEffectMigration).toBe(true);
  options.update({ backgroundColor: '#abcdef' });
  await options.flush();
  options.dispose();
  const viewer = new SettingsStore(db.port);
  await viewer.initialize();
  expect(viewer.getSnapshot().needsEffectMigration).toBe(true);
  viewer.update({ pageEffect: 'none' });
  await viewer.flush();
  expect(db.syncData[SETTINGS_KEY]).not.toHaveProperty('pendingPageEffectMigration');
  viewer.dispose();
});
