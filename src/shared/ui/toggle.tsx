export function Toggle({
  label,
  value,
  onChange,
  disabled = false,
  busy = false,
  descriptionId,
  showValue = true,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  busy?: boolean;
  descriptionId?: string;
  showValue?: boolean;
}) {
  return (
    <button
      type="button"
      className={`toggle ${value ? 'on' : ''}`}
      role="switch"
      aria-checked={value}
      aria-label={label}
      aria-describedby={descriptionId}
      aria-busy={busy || undefined}
      disabled={disabled}
      onClick={() => onChange(!value)}
    >
      <span aria-hidden="true" />
      {showValue ? (value ? '사용' : '미사용') : null}
    </button>
  );
}
