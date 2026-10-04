const names: Record<number, string> = {
  100: '가장 가늘게 / Thin',
  200: '매우 가늘게 / Extra Light',
  300: '가늘게 / Light',
  400: '보통 / Regular',
  500: '중간 / Medium',
  600: '약간 굵게 / Semi Bold',
  700: '굵게 / Bold',
  800: '매우 굵게 / Extra Bold',
  900: '가장 굵게 / Black',
};

export const fontWeightLabel = (weight: number) => `${names[weight] ?? '사용자 지정'} (${weight})`;
