export const sectionLinks = [
  ['text', '텍스트'],
  ['layout', '레이아웃'],
  ['appearance', '외관'],
  ['presets', '프리셋'],
  ['reading', '독서 도구'],
  ['lab', '실험실'],
  ['info', '정보'],
] as const;
export type SettingsSection = (typeof sectionLinks)[number][0];
export const sectionDescriptions: Record<SettingsSection, string> = {
  text: '글꼴과 문장의 간격을 조절합니다.',
  layout: '읽기 방식과 본문 안쪽의 공간을 조절합니다.',
  appearance: '바깥 배경과 본문 색상을 각각 조절합니다.',
  presets: '읽기 설정을 미리 보고, 원하는 모습으로 저장하세요.',
  reading: '회차 이동과 본문 탐색을 설정합니다.',
  lab: '직접 켠 기능만 사용합니다.',
  info: '확장프로그램 정보와 문의 창구입니다.',
};
