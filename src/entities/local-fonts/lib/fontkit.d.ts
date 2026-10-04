declare module 'fontkit' {
  export interface FontTableEntry {
    tag: string;
    length: number;
    offset?: number;
    compLength?: number;
    transformLength?: number;
  }

  export interface Font {
    type: 'TTF' | 'WOFF' | 'WOFF2';
    directory: { numTables: number; tables: Record<string, FontTableEntry> };
    stream: { pos: number };
    getName(key: string, language?: string): string | null;
    'OS/2'?: {
      usWeightClass: number;
      fsSelection: { italic?: boolean; oblique?: boolean };
    };
    fvar?: {
      axis: { axisTag: string; minValue: number; defaultValue: number; maxValue: number }[];
    };
    post?: { italicAngle: number };
  }

  export function create(buffer: Uint8Array): Font;
}
