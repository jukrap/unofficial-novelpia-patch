export interface ViewerModeStatus {
  connected: boolean;
  enabled: boolean;
  darkMode: boolean;
}

export type ViewerModeRequest =
  { type: 'unp:viewer-mode-status' } | { type: 'unp:viewer-mode-set'; enabled: boolean };

export type ViewerModeSetResult =
  { ok: true; connected: boolean } | { ok: false; connected: boolean; error: string };
