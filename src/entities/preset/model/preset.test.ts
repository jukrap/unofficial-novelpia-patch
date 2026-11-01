import { describe, it, expect } from 'vitest';
import {
  PresetStore,
  builtInPresets,
  legacyBuiltInPresets,
  findPreset,
  createPresetDraft,
  presetRevision,
  PresetConflictError,
  applyPresetSettings,
  presetSettingsEqual,
} from './store';
import { defaults } from '@/shared/model/preferences';
import { memoryStorage } from '../../../../tests/helpers/storage';
describe('preset storage and backups', () => {
  it('saves reading mode and page options while old presets keep the live reading behavior', async () => {
    const current = {
      ...defaults,
      readingMode: 'page' as const,
      spreadMode: 'single' as const,
      pageEffect: 'fold' as const,
      pageNavigationPlacement: 'fixed' as const,
    };
    expect(
      applyPresetSettings(current, findPreset('preset_builtin_paper')!.settings)
    ).toMatchObject({
      readingMode: 'page',
      spreadMode: 'single',
      pageEffect: 'fold',
      pageNavigationPlacement: 'fixed',
    });
    const store = new PresetStore(memoryStorage().port);
    await store.initialize();
    const saved = await store.save('페이지 독서', '', current);
    const imported = store.parseImport(store.export(current));
    expect(imported.settings).toMatchObject(current);
    expect(imported.presets[0]?.settings).toMatchObject({
      readingMode: 'page',
      spreadMode: 'single',
      pageEffect: 'fold',
      pageNavigationPlacement: 'fixed',
    });
    expect(applyPresetSettings(defaults, saved.settings)).toMatchObject(current);
    expect(presetSettingsEqual({ ...current, readingMode: 'scroll' }, saved.settings)).toBe(false);
    const legacy = store.parseImport(
      JSON.stringify({
        settings: { fontSize: 24 },
        presets: [
          {
            id: 'old',
            name: '기존',
            description: '',
            isDefault: false,
            createdAt: 1,
            settings: { fontSize: 24 },
          },
        ],
      })
    );
    expect(applyPresetSettings(current, legacy.presets[0]!.settings)).toMatchObject({
      readingMode: 'page',
      spreadMode: 'single',
      pageEffect: 'fold',
      pageNavigationPlacement: 'fixed',
      fontSize: 24,
    });
    expect(createPresetDraft(current, legacy.presets[0]).settings).toMatchObject({
      readingMode: 'page',
      spreadMode: 'single',
    });
    expect(new Set(builtInPresets.map((item) => item.settings.readingMode))).toEqual(
      new Set(['scroll', 'page'])
    );
    store.dispose();
  });
  it('round-trips paragraph spacing independently from blank lines and changes only the basic catalog appearance', async () => {
    const store = new PresetStore(memoryStorage().port);
    await store.initialize();
    const saved = await store.save('문단 여백', '', {
      ...defaults,
      paragraphGap: 16,
      paragraphSpacing: 8,
      wordBreakMode: 'normal',
    });
    const copy = store.parseImport(
      store.export({ ...defaults, paragraphGap: 16, paragraphSpacing: 8 })
    );
    expect(copy.presets[0]?.settings).toMatchObject({
      paragraphGap: 16,
      paragraphSpacing: 8,
      wordBreakMode: 'normal',
    });
    expect(applyPresetSettings(defaults, saved.settings)).toMatchObject({
      paragraphGap: 16,
      paragraphSpacing: 8,
    });
    expect(presetSettingsEqual(defaults, { ...defaults, paragraphGap: 2 })).toBe(false);
    expect(findPreset('preset_builtin_basic')?.settings).toMatchObject({
      fontFamily: 'Noto Sans KR',
      fontSize: 18,
      lineHeight: 200,
      maxWidth: 880,
      horizontalPadding: 0,
      paragraphSpacing: 35,
      paragraphGap: 1,
    });
    expect(findPreset('preset_builtin_dark')?.settings).toMatchObject({
      fontFamily: 'system-ui',
      lineHeight: 160,
      maxWidth: 875,
      paragraphSpacing: 8,
    });
    expect(findPreset('default_basic_preset')?.settings).toMatchObject({
      fontFamily: 'system-ui',
      lineHeight: 160,
      maxWidth: 875,
      paragraphSpacing: 8,
    });
    store.dispose();
  });
  it('keeps existing schema 1 presets when new layout fields are absent', async () => {
    const oldSettings = Object.fromEntries(
      Object.entries(defaults).filter(
        ([key]) =>
          ![
            'pageGap',
            'pageNavigationPlacement',
            'readerHeightPercent',
            'readingSurfaces',
            'paragraphGap',
          ].includes(key)
      )
    );
    const old = {
      id: 'old-user',
      name: '기존 사용자 설정',
      description: '',
      createdAt: 123,
      isDefault: false,
      settings: { ...oldSettings, fontSize: 27 },
    };
    const invalid = {
      ...old,
      id: 'broken-user',
      settings: { ...old.settings, fontSize: 'invalid' },
    };
    const db = memoryStorage({
      'unp.presetIndex.v1': { schemaVersion: 1, ids: [old.id, invalid.id], selectedId: old.id },
      [`unp.preset.v1.${old.id}`]: old,
      [`unp.preset.v1.${invalid.id}`]: invalid,
    });
    const store = new PresetStore(db.port);
    await store.initialize();
    expect(store.getSnapshot()).toMatchObject({
      selectedId: old.id,
      presets: [
        { id: old.id, createdAt: 123, settings: { fontSize: 27, pageGap: 20, paragraphGap: 1 } },
      ],
    });
    expect(store.getSnapshot().presets).toHaveLength(1);
    expect(db.syncData[`unp.preset.v1.${old.id}`]).toEqual(old);
    const imported = store.parseImport(
      JSON.stringify({ schemaVersion: 1, settings: oldSettings, presets: [old] })
    );
    expect(imported.settings).toMatchObject({
      pageGap: 20,
      pageNavigationPlacement: defaults.pageNavigationPlacement,
    });
    expect(imported.presets[0]?.settings).toMatchObject({
      pageGap: 20,
      fontSize: 27,
      readerHeightPercent: 100,
      readingSurfaces: 'theme',
      paragraphGap: 1,
    });
    expect(
      applyPresetSettings({ ...defaults, paragraphGap: 24 }, imported.presets[0]!.settings)
        .paragraphGap
    ).toBe(1);
    store.dispose();
  });

  it.each(['overlay', 'fixed'] as const)(
    'round-trips page gap while preserving %s navigation on preset apply',
    async (placement) => {
      const store = new PresetStore(memoryStorage().port);
      await store.initialize();
      const saved = await store.save('넓은 책 사이', '', {
        ...defaults,
        pageGap: 400,
        pageNavigationPlacement: placement,
        readerHeightPercent: 60,
        readingSurfaces: 'theme',
      });
      expect(saved.settings).toMatchObject({
        pageGap: 400,
        pageNavigationPlacement: defaults.pageNavigationPlacement,
      });
      const restored = store.parseImport(
        store.export({ ...defaults, pageNavigationPlacement: placement })
      );
      expect(restored.settings.pageNavigationPlacement).toBe(placement);
      expect(restored.presets[0]?.settings).toMatchObject({
        pageGap: 400,
        readerHeightPercent: 60,
        readingSurfaces: 'theme',
      });
      expect(
        applyPresetSettings({ ...defaults, pageNavigationPlacement: placement }, saved.settings)
      ).toMatchObject({
        pageGap: 400,
        pageNavigationPlacement: placement,
        readerHeightPercent: 60,
        readingSurfaces: 'theme',
      });
      expect(
        presetSettingsEqual(
          { ...defaults, pageGap: 88 },
          { ...defaults, pageGap: 88, pageNavigationPlacement: placement }
        )
      ).toBe(true);
      expect(presetSettingsEqual(defaults, { ...defaults, pageGap: 88 })).toBe(false);
      await expect(
        store.importBackup(JSON.stringify({ settings: { pageGap: 401 } }))
      ).rejects.toThrow('pageGap');
      await expect(
        store.importBackup(JSON.stringify({ settings: { pageNavigationPlacement: 'invalid' } }))
      ).rejects.toThrow('pageNavigationPlacement');
      store.dispose();
    }
  );
  it('offers ten presets and resolves all old IDs without serializing the catalogs', async () => {
    expect(builtInPresets.map((preset) => preset.name)).toEqual([
      '기본',
      '종이',
      '어두움',
      '큰 글씨',
      '좁은 본문',
      '넓은 본문',
      '밝은 돌빛',
      '옅은 녹색',
      '짙은 청회색',
      '차분한 보라',
    ]);
    expect(builtInPresets.slice(0, 4).map((preset) => preset.settings.fontSize)).toEqual([
      18, 20, 20, 26,
    ]);
    expect(legacyBuiltInPresets).toHaveLength(44);
    const catalogs = [...builtInPresets, ...legacyBuiltInPresets];
    expect(new Set(catalogs.map((preset) => preset.id)).size).toBe(54);
    expect(catalogs.every((preset) => !preset.settings.autoRecommend)).toBe(true);
    const db = memoryStorage();
    const store = new PresetStore(db.port);
    await store.initialize();
    expect(Object.keys(db.syncData).filter((k) => k.startsWith('unp.preset.v1.'))).toHaveLength(0);
    await expect(store.save('덮어쓰기', '', defaults, builtInPresets[0]!.id)).rejects.toThrow(
      '기본 프리셋'
    );
    for (const preset of legacyBuiltInPresets) {
      expect(findPreset(preset.id)).toEqual(preset);
      await store.select(preset.id);
      expect(store.getSnapshot().selectedId).toBe(preset.id);
    }
    expect(store.getSnapshot().presets).toHaveLength(0);
    await expect(store.save('덮어쓰기', '', defaults, legacyBuiltInPresets[0]!.id)).rejects.toThrow(
      '기본 프리셋'
    );
    store.dispose();
  });
  it('carries packaged backgrounds across copy/export/import without rewriting a saved appearance', async () => {
    const db = memoryStorage();
    const store = new PresetStore(db.port);
    await store.initialize();
    const old = findPreset('preset_builtin_paper')!;
    const saved = await store.save('예전 종이', '', { ...defaults, ...old.settings });
    expect(saved.settings).toMatchObject({
      maxWidth: 800,
      horizontalPadding: 30,
      verticalPadding: 20,
    });
    const scenes = builtInPresets.filter(
      (item) => item.settings.backgroundImageSource === 'builtin'
    );
    expect(scenes).toHaveLength(4);
    for (const scene of scenes) {
      const settings = applyPresetSettings(
        { ...defaults, autoRecommend: true, pageEffect: 'fold', pageNavigationPlacement: 'fixed' },
        scene.settings
      );
      expect(settings).toMatchObject({
        autoRecommend: true,
        readingMode: scene.settings.readingMode,
        pageEffect: scene.settings.pageEffect,
        pageNavigationPlacement: scene.settings.pageNavigationPlacement,
      });
      await store.save(scene.name, '', settings);
      const exported = store.export(settings);
      expect(exported).not.toContain('chrome-extension://');
      const restored = store.parseImport(exported);
      expect(restored.settings).toMatchObject({
        backgroundImageSource: 'builtin',
        backgroundAssetId: scene.settings.backgroundAssetId,
      });
      expect(restored.presets.find((item) => item.name === scene.name)?.settings).toMatchObject({
        backgroundAssetId: scene.settings.backgroundAssetId,
        readerHeightPercent: scene.settings.readerHeightPercent,
      });
    }
    expect(
      store.getSnapshot().presets.find((item) => item.id === saved.id)?.settings
    ).toMatchObject({ maxWidth: 800 });
    store.dispose();
  });
  it('serializes concurrent CRUD, keeps IDs and rejects duplicate names', async () => {
    const db = memoryStorage();
    const store = new PresetStore(db.port);
    await store.initialize();
    const [a, b] = await Promise.all([
      store.save('첫째', '설명', { ...defaults, autoRecommend: true }),
      store.save('둘째', '', defaults),
    ]);
    expect(store.getSnapshot().presets).toHaveLength(2);
    expect(store.getSnapshot().selectedId).toBeNull();
    expect(a.settings.autoRecommend).toBe(false);
    await expect(store.save('첫째', '', defaults)).rejects.toThrow('같은 이름');
    await store.save('수정', '설명', defaults, a.id);
    await store.remove(b.id);
    const next = new PresetStore(db.port);
    await next.initialize();
    expect(next.getSnapshot().presets).toMatchObject([{ id: a.id, name: '수정' }]);
    store.dispose();
    next.dispose();
  });
  it('accepts historic exports and rejects unsafe or future imports without mutation', async () => {
    const store = new PresetStore(memoryStorage().port);
    await store.initialize();
    expect(
      store.parseImport(
        JSON.stringify({
          exportInfo: { version: '1' },
          settings: { fontSize: 27, autoRecommend: true },
        })
      ).settings
    ).toMatchObject({ fontSize: 27, autoRecommend: false });
    for (const value of [
      '[]',
      'null',
      '{}',
      '{"schemaVersion":99,"settings":{"fontSize":25}}',
      '{"fontSize":90}',
      '{"backgroundImage":"javascript:alert(1)"}',
      '{"fontSize":22,"presets":{}}',
    ])
      expect(() => store.parseImport(value)).toThrow();
    expect(store.getSnapshot().presets).toHaveLength(0);
    store.dispose();
  });
  it('keeps failed saves out of the snapshot and preserves a separate recovery copy', async () => {
    const db = memoryStorage();
    const store = new PresetStore(db.port);
    await store.initialize();
    const before = structuredClone(store.getSnapshot());
    db.fail();
    await expect(store.save('독서', '', defaults)).rejects.toThrow();
    expect(store.getSnapshot()).toEqual(before);
    expect(db.localData['unp.presets.recovery.v1']).toBeDefined();
    expect(JSON.parse(store.export(defaults)).presets).toHaveLength(0);
    store.dispose();
  });
  it('imports a whole backup with fresh IDs and distinct names without enabling recommendation', async () => {
    const db = memoryStorage();
    const store = new PresetStore(db.port);
    await store.initialize();
    const original = await store.save('내 설정', '', defaults);
    const backup = store.export({ ...defaults, fontSize: 24, autoRecommend: true });
    const result = await store.importBackup(backup);
    expect(result).toMatchObject({ fontSize: 24, autoRecommend: false });
    expect(store.getSnapshot().presets.map((p) => p.name)).toEqual([
      '내 설정',
      '내 설정 (2)',
      '가져온 설정',
    ]);
    expect(new Set(store.getSnapshot().presets.map((p) => p.id)).size).toBe(3);
    expect(store.getSnapshot().presets[0]?.id).toBe(original.id);
    const restored = new PresetStore(db.port);
    await restored.initialize();
    expect(restored.getSnapshot().presets).toEqual(store.getSnapshot().presets);
    expect(restored.getSnapshot().selectedId).toBe(store.getSnapshot().presets.at(-1)?.id);
    restored.dispose();
    store.dispose();
  });
  it('rejects failed or invalid imports without adding a subset or changing selection', async () => {
    const db = memoryStorage();
    const store = new PresetStore(db.port);
    await store.initialize();
    await store.save('기존', '', defaults);
    const before = structuredClone(store.getSnapshot());
    const persisted = structuredClone(db.syncData);
    db.fail();
    await expect(store.importBackup(store.export(defaults))).rejects.toThrow('QUOTA');
    expect(store.getSnapshot()).toEqual(before);
    expect(db.syncData).toEqual(persisted);
    db.fail(false);
    await expect(store.importBackup('{"settings":{"fontSize":99}}')).rejects.toThrow();
    expect(store.getSnapshot()).toEqual(before);
    await store.importBackup(store.export(defaults));
    expect(store.getSnapshot().presets).toHaveLength(3);
    store.dispose();
  });

  it('edits a detached draft without changing active settings or selection', async () => {
    const store = new PresetStore(memoryStorage().port);
    await store.initialize();
    const source = await store.save('원본', '', defaults);
    await store.select(source.id);
    const active = { ...defaults, fontSize: 29, autoRecommend: true, recommendDelay: 80 };
    const draft = createPresetDraft(active, source);
    draft.settings.fontSize = 25;
    draft.name = '수정';
    expect(active.fontSize).toBe(29);
    expect(store.getSnapshot().presets[0]?.settings.fontSize).toBe(18);
    const saved = await store.saveDraft(draft);
    expect(saved.settings.fontSize).toBe(25);
    expect(store.getSnapshot().selectedId).toBe(source.id);
    const copy = createPresetDraft(active, saved, true);
    expect(copy.id).toBeUndefined();
    const copied = await store.saveDraft(copy);
    expect(copied.id).not.toBe(saved.id);
    expect(store.getSnapshot().selectedId).toBe(source.id);
    expect(active).toMatchObject({ fontSize: 29, autoRecommend: true, recommendDelay: 80 });
    store.dispose();
  });

  it('preserves creation time and list position when an existing preset is edited', async () => {
    const store = new PresetStore(memoryStorage().port);
    await store.initialize();
    const first = await store.save('첫째', '', defaults);
    const second = await store.save('둘째', '', defaults);
    await store.select(second.id);
    await store.save('이름 변경', '설명 추가', { ...defaults, fontSize: 21 }, first.id);
    expect(store.getSnapshot().presets.map((preset) => preset.id)).toEqual([first.id, second.id]);
    expect(store.getSnapshot().presets[0]).toMatchObject({
      name: '이름 변경',
      createdAt: first.createdAt,
      settings: { fontSize: 21 },
    });
    expect(store.getSnapshot().selectedId).toBe(second.id);
    store.dispose();
  });

  it('rejects a draft when another tab has edited its source and permits saving a copy', async () => {
    const db = memoryStorage();
    const first = new PresetStore(db.port);
    await first.initialize();
    const source = await first.save('원본', '', defaults);
    const second = new PresetStore(db.port);
    await second.initialize();
    const stale = createPresetDraft(defaults, source);
    stale.settings.fontSize = 30;
    const latest = await second.save('다른 화면', '', { ...defaults, fontSize: 20 }, source.id);
    const before = structuredClone(db.syncData);
    await expect(first.saveDraft(stale)).rejects.toMatchObject({
      code: 'PRESET_CONFLICT',
      current: latest,
    });
    expect(db.syncData).toEqual(before);
    const copied = await first.saveDraft({ ...stale, id: undefined, name: '내 초안' });
    expect(copied.settings.fontSize).toBe(30);
    expect(first.getSnapshot().presets.find((preset) => preset.id === source.id)).toEqual(latest);
    first.dispose();
    second.dispose();
  });

  it('detects a deleted source and stale deletion requests without resurrecting or losing changes', async () => {
    const db = memoryStorage();
    const store = new PresetStore(db.port);
    await store.initialize();
    const source = await store.save('원본', '', defaults);
    const draft = createPresetDraft(defaults, source);
    await store.save('최신', '', defaults, source.id);
    await expect(
      store.remove(source.id, { expectedRevision: draft.sourceRevision! })
    ).rejects.toBeInstanceOf(PresetConflictError);
    expect(store.getSnapshot().presets).toHaveLength(1);
    await store.remove(source.id);
    await expect(store.saveDraft(draft)).rejects.toMatchObject({
      code: 'PRESET_CONFLICT',
      current: null,
    });
    expect(store.getSnapshot().presets).toHaveLength(0);
    store.dispose();
  });

  it('rechecks persisted revisions even when storage notifications have not arrived', async () => {
    const db = memoryStorage();
    const store = new PresetStore(db.port);
    await store.initialize();
    const source = await store.save('원본', '', defaults);
    const draft = createPresetDraft(defaults, source);
    const updated = { ...source, description: '원격 변경' };
    db.syncData[`unp.preset.v1.${source.id}`] = updated;
    await expect(store.saveDraft(draft)).rejects.toMatchObject({ current: updated });
    store.dispose();
  });

  it('does not overwrite another preset when separate tabs update different items', async () => {
    const db = memoryStorage();
    const first = new PresetStore(db.port);
    await first.initialize();
    const a = await first.save('A', '', defaults);
    const b = await first.save('B', '', defaults);
    const second = new PresetStore(db.port);
    await second.initialize();
    await Promise.all([
      first.save('A 수정', '', { ...defaults, fontSize: 22 }, a.id),
      second.save('B 수정', '', { ...defaults, fontSize: 25 }, b.id),
    ]);
    const reloaded = new PresetStore(db.port);
    await reloaded.initialize();
    expect(reloaded.getSnapshot().presets.map((preset) => preset.settings.fontSize)).toEqual([
      22, 25,
    ]);
    first.dispose();
    second.dispose();
    reloaded.dispose();
  });

  it('keeps failed update, selection and deletion snapshots unchanged', async () => {
    const db = memoryStorage();
    const store = new PresetStore(db.port);
    await store.initialize();
    const source = await store.save('원본', '', defaults);
    await store.select(source.id);
    const before = structuredClone(store.getSnapshot());
    const persisted = structuredClone(db.syncData);
    db.fail();
    await expect(store.save('새 이름', '', defaults, source.id)).rejects.toThrow('QUOTA');
    expect(store.getSnapshot()).toEqual(before);
    await expect(store.select(null)).rejects.toThrow('QUOTA');
    expect(store.getSnapshot()).toEqual(before);
    await expect(store.remove(source.id)).rejects.toThrow('QUOTA');
    expect(store.getSnapshot()).toEqual(before);
    expect(db.syncData).toEqual(persisted);
    store.dispose();
  });

  it('preserves a hidden legacy selection and current reader values during migration', async () => {
    const legacy = legacyBuiltInPresets.at(-1)!;
    const reader = { schemaVersion: 1, data: { ...defaults, fontSize: 29 } };
    const db = memoryStorage({
      'unp.reader.v1': reader,
      novolpiaPatchPresets: legacyBuiltInPresets,
      currentPresetId: legacy.id,
    });
    const store = new PresetStore(db.port);
    await store.initialize();
    expect(store.getSnapshot()).toMatchObject({ presets: [], selectedId: legacy.id });
    expect(findPreset(store.getSnapshot().selectedId)?.name).toBe(legacy.name);
    expect(db.syncData['unp.reader.v1']).toEqual(reader);
    expect(JSON.parse(store.export(defaults)).presets).toEqual([]);
    store.dispose();
  });

  it('applies and compares the same visual keys without changing operational settings', () => {
    const current = {
      ...defaults,
      enabled: false,
      spreadMode: 'single' as const,
      autoRecommend: true,
      recommendDelay: 200,
    };
    const changed = applyPresetSettings(current, {
      ...defaults,
      fontSize: 25,
      backgroundColor: '#abcdef',
    });
    expect(changed).toMatchObject({
      fontSize: 25,
      backgroundColor: '#abcdef',
      enabled: false,
      spreadMode: 'single',
      autoRecommend: true,
      recommendDelay: 200,
    });
    expect(presetSettingsEqual(changed, { ...changed, backgroundColor: '#ABCDEF' })).toBe(true);
    expect(presetSettingsEqual(current, defaults)).toBe(true);
    expect(presetSettingsEqual(changed, defaults)).toBe(false);
    const source = builtInPresets[0]!;
    expect(presetRevision(source)).not.toBe(presetRevision({ ...source, name: '이름 변경' }));
  });

  it('stores only visual values from a draft while keeping the schema 1 settings shape', async () => {
    const db = memoryStorage();
    const store = new PresetStore(db.port);
    await store.initialize();
    const saved = await store.save('독서 설정', '', {
      ...defaults,
      fontSize: 25,
      enabled: false,
      spreadMode: 'single',
      autoRecommend: true,
      recommendDelay: 200,
    });
    expect(saved.settings).toMatchObject({
      fontSize: 25,
      enabled: defaults.enabled,
      spreadMode: defaults.spreadMode,
      autoRecommend: false,
      recommendDelay: defaults.recommendDelay,
    });
    expect(db.syncData[`unp.preset.v1.${saved.id}`]).toEqual(saved);
    expect(store.getSnapshot().selectedId).toBeNull();
    store.dispose();
  });

  it('rejects invalid visual fields instead of silently replacing them when renaming a draft', async () => {
    const db = memoryStorage();
    const store = new PresetStore(db.port);
    await store.initialize();
    const source = await store.save('원본', '', defaults);
    const before = structuredClone(store.getSnapshot());
    const draft = createPresetDraft(defaults, source);
    draft.name = '새 이름';
    draft.settings.textColor = 'invalid-color';
    await expect(store.saveDraft(draft)).rejects.toThrow();
    expect(store.getSnapshot()).toEqual(before);
    expect(db.syncData[`unp.preset.v1.${source.id}`]).toEqual(source);
    store.dispose();
  });
});
