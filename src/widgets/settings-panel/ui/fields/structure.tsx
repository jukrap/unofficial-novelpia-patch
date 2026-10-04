import { useId, type ReactNode } from 'react';
import { SettingLabel } from './setting-label';
import { settingHelp } from '../../config/help';
export function Section({
  title,
  active,
  id,
  description,
  children,
}: {
  title: string;
  active: boolean;
  id: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="section" data-section={id} hidden={!active} aria-label={title}>
      <header className="section-heading">
        <div>
          <h2 tabIndex={-1}>{title}</h2>
          {description ? <p className="section-description">{description}</p> : null}
        </div>
      </header>
      {children}
    </section>
  );
}
export function SettingGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="setting-group" role="group" aria-label={title}>
      <h3 className="group-heading">{title}</h3>
      {children}
    </div>
  );
}
export function Row({ label, children }: { label: string; children: ReactNode }) {
  const helpId = useId();
  return (
    <div className="row">
      <SettingLabel label={label} descriptionId={helpId} />
      <div
        className="control"
        role="group"
        aria-label={label}
        aria-describedby={settingHelp[label] ? helpId : undefined}
      >
        {children}
      </div>
    </div>
  );
}
