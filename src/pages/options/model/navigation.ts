import { optionsSections, type OptionsSection } from '../config/navigation';

export function sectionFromPath(path: string): OptionsSection | null {
  if (path === '/') return 'home';
  return optionsSections.find(([id]) => path === `/${id}`)?.[0] ?? null;
}

export function sectionPath(section: OptionsSection): string {
  return section === 'home' ? '/' : `/${section}`;
}
