/** Seconds; shared by React UI and the DOM reading engine. */
export const motionDuration = {
  control: 0.12,
  popover: 0.18,
  page: 0.24,
  reading: 0.32,
  background: 0.8,
} as const;
export const motionEase = [0.2, 0.6, 0.2, 1] as const;
