import type { LegacySettings } from '@/shared/model/types';

// Fresh desktop/mobile viewer observed on 2026-10-04. The engine owns layout,
// so 0 inner padding leaves the site's outer 20px clearance on narrow screens.
export const NATIVE_READING_DEFAULTS = {
  fontFamily: 'Noto Sans KR',
  fontSize: 18,
  fontWeight: 400,
  lineHeight: 200,
  maxWidth: 900,
  horizontalPadding: 0,
  verticalPadding: 0,
  // The existing blank-line control is an offset above its 1px empty block.
  // Preserve stored values and use 1 + 35 = 36px at the new 18px/200% defaults.
  paragraphSpacing: 35,
  wordBreakMode: 'normal',
} satisfies Partial<LegacySettings>;
