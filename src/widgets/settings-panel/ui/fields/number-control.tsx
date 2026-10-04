import { useEffect, useId, useState, type CSSProperties } from 'react';
import { numberControls, type NumericKey } from '@/shared/config/controls';
import { defaults, type Settings } from '@/shared/model/preferences';
import { Icon } from '@/shared/ui/icon';
import { SettingLabel } from './setting-label';
export function NumberControl({
  name,
  settings,
  onChange,
}: {
  name: NumericKey;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}) {
  const id = useId();
  const config = numberControls[name];
  const helpId = `${id}-help`;
  const value = settings[name];
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const number = Number(draft);
    if (draft.trim() && Number.isFinite(number)) {
      onChange({ [name]: Math.max(config.min, Math.min(config.max, number)) });
    } else setDraft(String(value));
  };
  const adjust = (direction: number) => {
    const parsed = draft.trim() ? Number(draft) : value;
    const next = Math.max(
      config.min,
      Math.min(
        config.max,
        Math.round(((Number.isFinite(parsed) ? parsed : value) + direction * config.step) * 100) /
          100
      )
    );
    setDraft(String(next));
    onChange({ [name]: next });
  };
  return (
    <div className="row number-row">
      <SettingLabel label={config.label} htmlFor={id} descriptionId={helpId} />
      <div className="control">
        <div className="number-line">
          <input
            aria-label={`${config.label} 슬라이더`}
            type="range"
            min={config.min}
            max={config.max}
            step={config.step}
            value={value}
            style={
              {
                '--range-fill': `${(100 * (value - config.min)) / (config.max - config.min)}%`,
              } as CSSProperties
            }
            onChange={(e) => onChange({ [name]: Number(e.target.value) })}
          />
          <div className="number-input">
            <button
              type="button"
              aria-label={`${config.label} 줄이기`}
              disabled={value <= config.min}
              onClick={() => adjust(-1)}
            >
              <Icon name="minus" />
            </button>
            <input
              id={id}
              aria-describedby={helpId}
              type="number"
              min={config.min}
              max={config.max}
              step={config.step}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commit();
                  e.currentTarget.blur();
                }
              }}
            />
            <button
              type="button"
              aria-label={`${config.label} 늘리기`}
              disabled={value >= config.max}
              onClick={() => adjust(1)}
            >
              <Icon name="plus" />
            </button>
          </div>
          <span className="unit">{config.unit}</span>
        </div>
        <div className="quick">
          <button
            type="button"
            className={value === defaults[name] ? 'active' : ''}
            aria-pressed={value === defaults[name]}
            title={`기본값 ${defaults[name]}${config.unit}`}
            onClick={() => onChange({ [name]: defaults[name] })}
          >
            기본
          </button>
          {config.quick.map((n) => (
            <button
              type="button"
              title={`${n}${config.unit}`}
              aria-label={`${config.label} ${n}${config.unit}`}
              className={value === n ? 'active' : ''}
              aria-pressed={value === n}
              key={n}
              onClick={() => onChange({ [name]: n })}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
