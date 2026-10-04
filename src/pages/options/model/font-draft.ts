import type { UserFont, UserFontFace, FontInspection, FontWrite } from '@/shared/model/user-font';
export interface FontDraft {
  id: string;
  family: string;
  displayName: string;
  expectedRevision: string | null;
  faces: (UserFontFace & { data?: string })[];
}
export function editFont(font: UserFont): FontDraft {
  return {
    ...font,
    expectedRevision: font.revision,
    faces: font.faces.map((face) => ({ ...face })),
  };
}
export function appendFontFiles(
  drafts: FontDraft[],
  registered: UserFont[],
  files: { info: FontInspection; data: string }[]
): FontDraft[] {
  const next = drafts.map((draft) => ({ ...draft, faces: [...draft.faces] }));
  for (const { info, data } of files) {
    let group = next.find((draft) => draft.id === info.familyId);
    if (!group) {
      const existing = registered.find((font) => font.id === info.familyId);
      group = existing
        ? editFont(existing)
        : {
            id: info.familyId,
            family: info.family,
            displayName: info.family,
            expectedRevision: null,
            faces: [],
          };
      next.push(group);
    }
    if (!group.faces.some((face) => face.id === info.id)) group.faces.push({ ...info, data });
  }
  return next;
}
export function fontWrites(drafts: FontDraft[]): FontWrite[] {
  return drafts.map((draft) => ({
    id: draft.id,
    displayName: draft.displayName,
    expectedRevision: draft.expectedRevision,
    keep: draft.faces.filter((face) => !face.data).map((face) => face.id),
    files: draft.faces
      .filter((face) => face.data)
      .map((face) => ({ name: face.fileName, data: face.data! })),
  }));
}
