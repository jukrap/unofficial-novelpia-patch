import { sectionDescriptions } from '@/shared/config/settings-sections';

export const optionsSections = [
  ['home', '홈'],
  ['presets', '프리셋'],
  ['text', '텍스트'],
  ['layout', '레이아웃'],
  ['appearance', '외관'],
  ['lab', '실험실'],
  ['fonts', '사용자 글꼴'],
  ['files', '설정 파일'],
  ['misc', '기타'],
  ['info', '정보'],
] as const;
export type OptionsSection = (typeof optionsSections)[number][0];
export const optionsDescriptions: Record<OptionsSection, string> = {
  ...sectionDescriptions,
  home: '노벨피아의 글꼴, 여백과 테마를 조절하는 비공식 확장프로그램입니다.',
  files: '읽기 설정과 내 프리셋을 저장하거나 다른 브라우저에서 가져옵니다.',
  fonts: '글꼴 파일에서 이름과 두께를 읽어 이 브라우저에 등록합니다.',
  misc: '설정 초기화와 이 브라우저의 독서 기록을 관리합니다.',
};
