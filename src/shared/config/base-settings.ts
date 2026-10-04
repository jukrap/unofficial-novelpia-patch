import type { LegacySettings as Settings } from '@/shared/model/types';

// Historical baseline retained by existing named presets. Runtime defaults add
// the observed native typography in model/preferences.ts.
export const DEFAULT_SETTINGS: Settings = {
  // 레이아웃 설정
  maxWidth: 875,
  horizontalPadding: 20,
  verticalPadding: 0,

  // 텍스트 설정
  fontFamily: 'system-ui',
  fontSize: 18,
  fontWeight: 400,
  forceBold: false,
  enhanceBoldTextStyle: 'none', // "none", "shadow", "highlight", "border"
  letterSpacing: 0,
  lineHeight: 160,
  paragraphSpacing: 8, // 기존 확장 프리셋의 빈 줄 높이 보정값
  wordBreakMode: 'keep-all', // 줄바꿈 방식 - "keep-all" (단어 단위), "break-all" (글자 단위)

  // 외관 설정
  backgroundType: 'color',
  backgroundColor: '#FFFFFF',
  backgroundImage: '',
  overlayColor: '#000000',
  overlayOpacity: 0,
  textColor: '#000000',
  textAreaBackgroundColor: '#ffffff',
  textAreaOpacity: 100,

  // 기타
  darkMode: false,

  // 실험실 설정
  autoRecommend: false,
  recommendDelay: 30,
};

// 대폭 확장된 기본 제공 프리셋들 (웹소설 독자 맞춤)
