import { MotionButton } from '@/shared/ui/motion-button';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { COLOR_PALETTES } from '@/shared/config/paletteData';
import { Dropdown } from '@/shared/ui/dropdown';
import { useRecentColors } from '../../model/recent-colors';
import { Row } from './structure';
export function ColorControl({
  label,
  value,
  onChange,
  remember = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  remember?: boolean;
}) {
  const [category, setCategory] = useState('basic');
  const [draft, setDraft] = useState(value);
  const recent = useRecentColors();
  const editedColor = useRef<string | null>(null);
  const commit = (color: string) => {
    onChange(color);
    if (remember) recent.remember(color);
  };
  const commitSlider = () => {
    if (remember && editedColor.current) recent.remember(editedColor.current);
    editedColor.current = null;
  };
  useEffect(() => setDraft(value), [value]);
  const palette = (COLOR_PALETTES[category] ?? Object.values(COLOR_PALETTES)[0])!;
  return (
    <Row label={label}>
      <Dropdown
        className="color-dropdown"
        viewportEndSelector=".color-inputs"
        viewportKey={category}
        label={`${label}: ${value}`}
        trigger={
          <>
            <span className="swatch" style={{ background: value }} />
            {value.toUpperCase()}
          </>
        }
      >
        {() => (
          <>
            <div className="tabs">
              {Object.entries({
                recent: { name: '최근 선택', colors: recent.colors },
                ...COLOR_PALETTES,
              }).map(([key, group]) => (
                <MotionButton
                  type="button"
                  className={category === key ? 'active' : ''}
                  aria-pressed={category === key}
                  key={key}
                  onClick={() => setCategory(key)}
                >
                  {group.name}
                </MotionButton>
              ))}
            </div>
            <div className="palette">
              {(category === 'recent' ? recent.colors : palette.colors).map((color) => (
                <MotionButton
                  type="button"
                  key={color}
                  className={`swatch ${color.toLowerCase() === value.toLowerCase() ? 'selected' : ''}`}
                  aria-pressed={color.toLowerCase() === value.toLowerCase()}
                  style={{ background: color }}
                  aria-label={`${label} ${color}`}
                  onClick={() => commit(color)}
                >
                  {color.toLowerCase() === value.toLowerCase() ? (
                    <span className="swatch-check">✓</span>
                  ) : null}
                </MotionButton>
              ))}
            </div>
            {category === 'recent' && recent.colors.length === 0 ? (
              <p className="hint">최근 선택한 색상이 없습니다.</p>
            ) : null}
            <section className="color-current" aria-label={`${label} 현재 색상`}>
              <h3>현재 색상</h3>
              <div className="color-inputs">
                <span
                  className="color-preview"
                  role="img"
                  aria-label={`${label} 미리보기 ${value}`}
                  style={{ background: value }}
                />
                <input
                  aria-label={`${label} HEX`}
                  value={draft}
                  maxLength={7}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                  }}
                  onBlur={() => {
                    if (/^#[\da-f]{6}$/i.test(draft) && draft.toUpperCase() !== value.toUpperCase())
                      commit(draft);
                    else setDraft(value);
                  }}
                />
              </div>
              <div className="rgb-controls">
                {['빨강', '초록', '파랑'].map((channel, index) => {
                  const amount = parseInt(value.slice(1 + index * 2, 3 + index * 2), 16);
                  return (
                    <div className="rgb-channel" key={channel}>
                      <span aria-hidden="true">{['R', 'G', 'B'][index]}</span>
                      <input
                        type="range"
                        min={0}
                        max={255}
                        step={1}
                        value={amount}
                        aria-label={`${label} ${channel}`}
                        style={{ '--range-fill': `${(amount / 255) * 100}%` } as CSSProperties}
                        onPointerUp={commitSlider}
                        onKeyUp={commitSlider}
                        onBlur={commitSlider}
                        onChange={(event) => {
                          const channels = [0, 1, 2].map((i) =>
                            i === index
                              ? Number(event.target.value)
                              : parseInt(value.slice(1 + i * 2, 3 + i * 2), 16)
                          );
                          const color =
                            '#' + channels.map((n) => n.toString(16).padStart(2, '0')).join('');
                          editedColor.current = color;
                          onChange(color);
                        }}
                      />
                      <output>{amount}</output>
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </Dropdown>
    </Row>
  );
}
