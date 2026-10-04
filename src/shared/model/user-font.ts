export const USER_FONT_CHANNEL = 'unp.user-fonts.v1';
export const USER_FONT_REVISION = 'unp.user-fonts.revision';
export const FONT_FILE_LIMIT = 20 * 1024 * 1024;
export const FONT_BATCH_LIMIT = 32 * 1024 * 1024;
export const FONT_STORAGE_LIMIT = 100 * 1024 * 1024;
export interface UserFontFace {
  id: string;
  fileName: string;
  size: number;
  weight: number;
  minWeight: number;
  maxWeight: number;
  style: 'normal' | 'italic';
  variable: boolean;
}
export interface UserFont {
  id: string;
  family: string;
  displayName: string;
  revision: string;
  faces: UserFontFace[];
}
export interface FontInspection extends UserFontFace {
  family: string;
  familyId: string;
  fullName: string;
}
export interface FontWrite {
  id: string;
  displayName: string;
  expectedRevision: string | null;
  keep: string[];
  files: { name: string; data: string }[];
}
export function userFontWeights(font: UserFont): number[] {
  return [
    ...new Set(
      font.faces
        .filter((face) => face.style === 'normal')
        .flatMap((face) => {
          if (!face.variable) return [face.weight];
          return [
            face.minWeight,
            face.weight,
            face.maxWeight,
            ...Array.from({ length: 9 }, (_, n) => (n + 1) * 100),
          ].filter((weight) => weight >= face.minWeight && weight <= face.maxWeight);
        })
    ),
  ]
    .filter((weight) => weight >= 100 && weight <= 900)
    .sort((a, b) => a - b);
}
