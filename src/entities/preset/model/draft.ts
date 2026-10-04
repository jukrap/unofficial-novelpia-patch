import {
  applyPresetSettings,
  defaults,
  PRESET_SETTING_KEYS,
  type Preset,
  type Settings,
} from '@/shared/model/preferences';

export interface PresetDraft {
  id?: string;
  sourceId: string | null;
  sourceRevision: string | null;
  name: string;
  description: string;
  settings: Settings;
}

/** Content revision works with schema 1 and old writers without extra storage keys. */
export function presetRevision(preset: Preset): string {
  return JSON.stringify([
    preset.id,
    preset.name,
    preset.description,
    preset.createdAt,
    preset.isDefault,
    ...PRESET_SETTING_KEYS.map((key) => preset.settings[key] ?? defaults[key]),
  ]);
}

export function createPresetDraft(
  current: Settings,
  source?: Preset,
  duplicate = false
): PresetDraft {
  return {
    ...(!source?.isDefault && source && !duplicate ? { id: source.id } : {}),
    sourceId: source?.id ?? null,
    sourceRevision: source ? presetRevision(source) : null,
    name: source
      ? duplicate || source.isDefault
        ? `${source.name.slice(0, 76)} 복사`
        : source.name
      : '',
    description: source?.description ?? '',
    settings: source ? applyPresetSettings(current, source.settings) : { ...current },
  };
}

export class PresetConflictError extends Error {
  readonly code = 'PRESET_CONFLICT';
  constructor(readonly current: Preset | null) {
    super(
      current
        ? '다른 화면에서 프리셋을 수정했습니다. 최신 내용을 불러오거나 새 프리셋으로 저장해 주세요.'
        : '다른 화면에서 프리셋을 삭제했습니다. 새 프리셋으로 저장해 주세요.'
    );
    this.name = 'PresetConflictError';
  }
}
