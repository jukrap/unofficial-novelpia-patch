export interface LegacySettings {
  // 레이아웃
  maxWidth: number;
  horizontalPadding: number;
  verticalPadding: number;

  // 텍스트
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  forceBold: boolean;
  enhanceBoldTextStyle: 'none' | 'shadow' | 'highlight' | 'border';
  letterSpacing: number;
  lineHeight: number;
  paragraphSpacing: number;
  wordBreakMode: 'normal' | 'break-all' | 'keep-all';

  // 외관
  backgroundType: 'color' | 'image';
  backgroundColor: string;
  backgroundImage: string;
  overlayColor: string;
  overlayOpacity: number;
  textColor: string;
  textAreaBackgroundColor: string;
  textAreaOpacity: number;

  // 다크 모드
  darkMode: boolean;

  // 실험실 설정
  autoRecommend: boolean;
  recommendDelay: number;
}

export interface BackgroundImageSettings {
  backgroundImageSource: 'url' | 'file';
  backgroundAssetId: string | null;
}
export type PageEffect = 'none' | 'slide' | 'fade' | 'paper' | 'fold';
export type Settings = LegacySettings &
  BackgroundImageSettings & {
    enabled: boolean;
    spreadMode: 'auto' | 'single';
    pageGap: number;
    pageNavigationPlacement: 'reserved' | 'fixed' | 'overlay';
    readerHeightPercent: number;
    readingSurfaces: 'default' | 'translucent' | 'opaque' | 'theme';
    backgroundImageFade: boolean;
    pageEffect: PageEffect;
    paragraphGap: number;
  };
export interface Preset {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  createdAt: number;
  settings: LegacySettings &
    Partial<BackgroundImageSettings> &
    Partial<Pick<Settings, 'pageGap' | 'readerHeightPercent' | 'readingSurfaces' | 'paragraphGap'>>;
}
