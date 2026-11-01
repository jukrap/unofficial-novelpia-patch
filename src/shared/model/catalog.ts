export type FontCategory = 'System' | 'Sans' | 'Serif' | 'Calligraphy' | 'Display';

export interface FontUrlData {
  type: 'google' | 'jsdelivr' | 'cdn' | 'custom';
  url: string;
  format: 'css';
  subset?: boolean;
  weights?: number[];
  css?: string;
}

export interface FontMetadata {
  variableFont: boolean;
  weights: number[];
  publisher: string;
  license: string;
}

export interface FontData {
  name: string;
  displayName: string;
  category: FontCategory;
  description: string;
  metadata: FontMetadata;
  urls: FontUrlData[];
  isSystemFont?: boolean;
  localRevision?: string;
}

export type PaletteCategory =
  'basic' | 'nature' | 'dark' | 'soft' | 'accent' | 'warm' | 'grayscale';

export interface PaletteData {
  name: string;
  colors: string[];
}

export interface ColorPalettes {
  [key: string]: PaletteData;
}
