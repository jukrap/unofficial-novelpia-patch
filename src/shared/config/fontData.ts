// Unofficial Novelpia Patch - Font Data
// 확장프로그램에서 사용할 글꼴 데이터

import type { FontCategory, FontData } from '@/shared/model/catalog';

/** All faces share one stylesheet because the reader loads one resource per family. */
function remoteFont(
  data: Omit<FontData, 'urls' | 'metadata'> & { publisher: string; license: string },
  faces: [number, string][]
): FontData {
  const { publisher, license, ...font } = data;
  const weights = faces.map(([weight]) => weight);
  return {
    ...font,
    metadata: { variableFont: false, weights, publisher, license },
    urls: [
      {
        type: 'custom',
        url: 'custom',
        format: 'css',
        weights,
        css: faces
          .map(
            ([weight, url]) => `@font-face {
  font-family: '${font.name}';
  src: url('${url}') format('${url.endsWith('.woff2') ? 'woff2' : 'woff'}');
  font-weight: ${weight};
  font-style: normal;
  font-display: swap;
}`
          )
          .join('\n'),
      },
    ],
  };
}

const FREESENTATION_SOURCE =
  'https://cdn.jsdelivr.net/gh/Freesentation/freesentation@98f6b841fca55a23fbb0f9eb91acda0e16a676ea/woff2';
const PYEOJIN_SOURCE =
  'https://cdn.jsdelivr.net/gh/Jihwan-Suh/PyeojinGothic@0f9af0f3365037c1127a2e96828df3b2b9bd0c85/fonts/web/woff2';

const fontCatalog: FontData[] = [
  // System (기본체)
  {
    name: 'system-ui',
    displayName: '시스템 기본',
    category: 'System',
    description: '운영체제의 기본 글꼴입니다.',
    metadata: {
      variableFont: false,
      weights: [400, 700],
      publisher: 'System',
      license: 'System Font',
    },
    urls: [],
    isSystemFont: true,
  },
  // Sans (돋움체)
  {
    name: 'Noto Sans KR',
    displayName: '노토 산스 KR',
    category: 'Sans',
    description: '구글의 노토 시리즈 중 한글 돋움체로, 가변 글꼴을 지원합니다.',
    metadata: {
      variableFont: true,
      weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
      publisher: 'Google',
      license: 'Open Font License',
    },
    urls: [
      {
        type: 'google',
        url: 'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@100..900&display=swap',
        format: 'css',
      },
    ],
  },
  {
    name: 'Pretendard',
    displayName: '프리텐다드',
    category: 'Sans',
    description: '오픈소스 글꼴 Inter를 기반으로 한 한글 가변 글꼴입니다.',
    metadata: {
      variableFont: true,
      weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
      publisher: 'Kil Hyung-jin',
      license: 'Open Font License',
    },
    urls: [
      {
        type: 'jsdelivr',
        url: 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css',
        subset: true,
        format: 'css',
      },
    ],
  },
  {
    name: 'IBM Plex Sans KR',
    displayName: 'IBM Plex Sans KR',
    category: 'Sans',
    description: 'IBM이 제작한 Plex 시리즈의 한글 돋움체입니다.',
    metadata: {
      variableFont: false,
      weights: [100, 200, 300, 400, 500, 600, 700],
      publisher: 'IBM',
      license: 'Open Font License',
    },
    urls: [
      {
        type: 'google',
        url: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@100;200;300;400;500;600;700&display=swap',
        format: 'css',
      },
    ],
  },
  {
    name: 'NanumSquare Neo',
    displayName: '나눔스퀘어 네오',
    category: 'Sans',
    description: '네이버에서 제공하는 나눔스퀘어의 개선 버전입니다.',
    metadata: {
      variableFont: false,
      weights: [100, 300, 500, 700, 800],
      publisher: 'NAVER',
      license: 'NAVER Font License',
    },
    urls: [
      {
        type: 'cdn',
        url: 'https://cdn.jsdelivr.net/npm/nanumsquareneo@0.0.5/nanumsquareneo.css',
        format: 'css',
      },
    ],
  },
  {
    name: '42dot Sans',
    displayName: '42도트 산스',
    category: 'Sans',
    description: '현대자동차 그룹의 모빌리티 브랜드 42dot의 가변 글꼴입니다.',
    metadata: {
      variableFont: true,
      weights: [300, 400, 500, 600, 700, 800],
      publisher: 'Hyundai Motor Group',
      license: 'Open Font License',
    },
    urls: [
      {
        type: 'google',
        url: 'https://fonts.googleapis.com/css2?family=42dot+Sans:wght@300..800&display=swap',
        format: 'css',
      },
    ],
  },
  {
    name: 'Jua',
    displayName: '주아체',
    category: 'Display',
    description: '아날로그 감성의 부드러운 느낌을 가진 돋움체입니다.',
    metadata: {
      variableFont: false,
      weights: [400],
      publisher: 'WOOWAHAN BROTHERS',
      license: 'Open Font License',
    },
    urls: [
      {
        type: 'google',
        url: 'https://fonts.googleapis.com/css2?family=Jua&display=swap',
        format: 'css',
      },
    ],
  },
  // Serif (바탕체)
  {
    name: 'Noto Serif KR',
    displayName: '노토 세리프 KR',
    category: 'Serif',
    description: '구글의 노토 시리즈 중 한글 바탕체로, 가변 글꼴을 지원합니다.',
    metadata: {
      variableFont: true,
      weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
      publisher: 'Google',
      license: 'Open Font License',
    },
    urls: [
      {
        type: 'google',
        url: 'https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@200..900&display=swap',
        format: 'css',
      },
    ],
  },
  {
    name: 'Hahmlet',
    displayName: '함렛',
    category: 'Serif',
    description: '한글 타이포그래피를 위해 디자인된 현대적인 세리프체입니다.',
    metadata: {
      variableFont: true,
      weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
      publisher: 'Hyundai Card',
      license: 'Open Font License',
    },
    urls: [
      {
        type: 'google',
        url: 'https://fonts.googleapis.com/css2?family=Hahmlet:wght@100..900&display=swap',
        format: 'css',
      },
    ],
  },
  {
    name: 'Nanum Myeongjo',
    displayName: '나눔바탕',
    category: 'Serif',
    description: '네이버에서 제공하는 전통적인 한글 바탕체입니다.',
    metadata: {
      variableFont: false,
      weights: [400, 700, 800],
      publisher: 'NAVER',
      license: 'NAVER Font License',
    },
    urls: [
      {
        type: 'google',
        url: 'https://fonts.googleapis.com/css2?family=Nanum+Myeongjo:wght@400;700;800&display=swap',
        format: 'css',
      },
    ],
  },
  {
    name: 'MaruBuri',
    displayName: '마루부리',
    category: 'Serif',
    description: '부드러운 획의 표현이 특징인 현대적인 바탕체입니다.',
    metadata: {
      variableFont: false,
      weights: [200, 300, 400, 600, 700],
      publisher: 'JHSoft',
      license: 'Open Font License',
    },
    urls: [
      {
        type: 'cdn',
        url: 'https://cdn.jsdelivr.net/npm/@kfonts/maruburi@0.1.0/index.min.css',
        format: 'css',
      },
    ],
  },
  {
    name: 'RIDIBatang',
    displayName: '리디바탕',
    category: 'Serif',
    description: '리디에서 제작한 전자책에 최적화된 바탕체입니다.',
    metadata: {
      variableFont: false,
      weights: [400],
      publisher: 'RIDI Corporation',
      license: 'Open Font License',
    },
    urls: [
      {
        type: 'jsdelivr',
        url: 'https://cdn.jsdelivr.net/npm/@kfonts/ridi-batang@0.1.3/index.min.css',
        format: 'css',
      },
    ],
  },
  // Calligraphy (손글씨체)
  {
    name: 'Hakgyoansim Butpen',
    displayName: '학교안심붓펜',
    category: 'Calligraphy',
    description: '붓펜으로 쓴 듯한 자연스러운 손글씨체입니다.',
    metadata: {
      variableFont: false,
      weights: [300, 400, 700],
      publisher: 'PureunJeonnam',
      license: 'Free for personal use',
    },
    urls: [
      // CSS로 통합하여 관리
      {
        type: 'custom',
        url: 'custom',
        format: 'css',
        weights: [300, 400, 700],
        css: `
          @font-face {
            font-family: 'Hakgyoansim Butpen';
            src: url('https://fastly.jsdelivr.net/gh/projectnoonnu/noonfonts_2307-2@1.0/HakgyoansimButpenL.woff2') format('woff2');
            font-weight: 300;
            font-style: normal;
          }
          @font-face {
            font-family: 'Hakgyoansim Butpen';
            src: url('https://fastly.jsdelivr.net/gh/projectnoonnu/noonfonts_2307-2@1.0/HakgyoansimButpenM.woff2') format('woff2');
            font-weight: 400;
            font-style: normal;
          }
          @font-face {
            font-family: 'Hakgyoansim Butpen';
            src: url('https://fastly.jsdelivr.net/gh/projectnoonnu/noonfonts_2307-2@1.0/HakgyoansimButpenB.woff2') format('woff2');
            font-weight: 700;
            font-style: normal;
          }
        `,
      },
    ],
  },
  {
    name: 'J Gaegujaengyi',
    displayName: 'J개구쟁이',
    category: 'Calligraphy',
    description: '장난스럽고 귀여운 느낌의 손글씨체입니다.',
    metadata: {
      variableFont: false,
      weights: [300, 400, 700],
      publisher: 'Jikji Font',
      license: 'Free for personal use',
    },
    urls: [
      {
        type: 'custom',
        url: 'custom',
        format: 'css',
        weights: [300, 400, 700],
        css: `
          @font-face {
            font-family: 'J Gaegujaengyi';
            src: url('https://fastly.jsdelivr.net/gh/projectnoonnu/noonfonts_2110@1.0/JGaegujaengyi-Light-KO.woff2') format('woff2');
            font-weight: 300;
            font-style: normal;
          }
          @font-face {
            font-family: 'J Gaegujaengyi';
            src: url('https://fastly.jsdelivr.net/gh/projectnoonnu/noonfonts_2110@1.0/JGaegujaengyi-Medium-KO.woff2') format('woff2');
            font-weight: 400;
            font-style: normal;
          }
          @font-face {
            font-family: 'J Gaegujaengyi';
            src: url('https://fastly.jsdelivr.net/gh/projectnoonnu/noonfonts_2110@1.0/JGaegujaengyi-Bold-KO.woff2') format('woff2');
            font-weight: 700;
            font-style: normal;
          }
        `,
      },
    ],
  },
  {
    name: 'Yeon Sung',
    displayName: '연성체',
    category: 'Calligraphy',
    description: '자연스러운 필기체의 느낌을 살린 손글씨체입니다.',
    metadata: {
      variableFont: false,
      weights: [400],
      publisher: 'WOOWAHAN BROTHERS',
      license: 'Open Font License',
    },
    urls: [
      {
        type: 'google',
        url: 'https://fonts.googleapis.com/css2?family=Yeon+Sung&display=swap',
        format: 'css',
      },
    ],
  },
  remoteFont(
    {
      name: 'Freesentation',
      displayName: '프리젠테이션',
      category: 'Sans',
      description: '본고딕과 Roboto를 바탕으로 발표 자료의 가독성을 위해 다듬은 글꼴입니다.',
      publisher: 'Freesentation Authors',
      license: 'SIL Open Font License 1.1',
    },
    [
      [100, `${FREESENTATION_SOURCE}/Freesentation-1Thin.woff2`],
      [200, `${FREESENTATION_SOURCE}/Freesentation-2ExtraLight.woff2`],
      [300, `${FREESENTATION_SOURCE}/Freesentation-3Light.woff2`],
      [400, `${FREESENTATION_SOURCE}/Freesentation-4Regular.woff2`],
      [500, `${FREESENTATION_SOURCE}/Freesentation-5Medium.woff2`],
      [600, `${FREESENTATION_SOURCE}/Freesentation-6SemiBold.woff2`],
      [700, `${FREESENTATION_SOURCE}/Freesentation-7Bold.woff2`],
      [800, `${FREESENTATION_SOURCE}/Freesentation-8ExtraBold.woff2`],
      [900, `${FREESENTATION_SOURCE}/Freesentation-9Black.woff2`],
    ]
  ),
  remoteFont(
    {
      name: 'MuseumCulturalFoundationClassic',
      displayName: '국립박물관문화재단 클래식체',
      category: 'Serif',
      description: '국립박물관문화재단의 고풍스러운 획을 담은 클래식 서체입니다.',
      publisher: '국립박물관문화재단',
      license: '국립박물관문화재단 클래식체 사용조건',
    },
    [
      [
        300,
        'https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_twelve@1.0/국립박물관문화재단클래식L.woff',
      ],
      [
        500,
        'https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_twelve@1.0/국립박물관문화재단클래식M.woff',
      ],
      [
        700,
        'https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_twelve@1.0/국립박물관문화재단클래식B.woff',
      ],
    ]
  ),
  remoteFont(
    {
      name: 'KimJeongCheolHandwriting',
      displayName: '김정철 손글씨',
      category: 'Calligraphy',
      description: '건축가 김정철의 손글씨를 바탕으로 만든 자연스러운 필기체입니다.',
      publisher: '정림건축',
      license: '김정철 서체 라이선스',
    },
    [
      [
        300,
        'https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2302_01@1.0/KimjungchulScript-Light.woff2',
      ],
      [
        400,
        'https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2302_01@1.0/KimjungchulScript-Regular.woff2',
      ],
      [
        700,
        'https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2302_01@1.0/KimjungchulScript-Bold.woff2',
      ],
    ]
  ),
  remoteFont(
    {
      name: 'Yeongdo',
      displayName: '영도체',
      category: 'Display',
      description: '한 선 잇기를 모티브로 영도의 지역 정체성을 담은 장식 글꼴입니다.',
      publisher: '영도구청·영도문화도시센터',
      license: '영도체 오픈 라이선스',
    },
    [
      [400, 'https://cdn.jsdelivr.net/gh/projectnoonnu/2410-1@1.2/Yeongdo-Rg.woff2'],
      [700, 'https://cdn.jsdelivr.net/gh/projectnoonnu/2410-1@1.2/Yeongdo-Bd.woff2'],
      [900, 'https://cdn.jsdelivr.net/gh/projectnoonnu/2410-1@1.2/Yeongdo-Hv.woff2'],
    ]
  ),
  remoteFont(
    {
      name: 'JeonjuWanpanbon',
      displayName: '전주완판본 각체',
      category: 'Serif',
      description: '전주에서 간행한 완판본의 목판 글씨를 현대적으로 다듬은 글꼴입니다.',
      publisher: '전주시',
      license: '전주완판본체 사용조건',
    },
    [
      [300, 'https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2102-01@1.0/Jeonju_gakL.woff'],
      [400, 'https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2102-01@1.0/Jeonju_gakR.woff'],
      [700, 'https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2102-01@1.0/Jeonju_gakB.woff'],
    ]
  ),
  remoteFont(
    {
      name: 'IncheonEducation',
      displayName: '인천교육자람체',
      category: 'Calligraphy',
      description: '인천 시민의 손글씨를 바탕으로 개발한 친근한 글꼴입니다.',
      publisher: '인천광역시교육청',
      license: '인천교육서체 사용조건',
    },
    [[400, 'https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2307-2@1.0/iceJaram-Rg.woff2']]
  ),
  remoteFont(
    {
      name: 'NexonMaplestory',
      displayName: '메이플스토리',
      category: 'Display',
      description: '메이플스토리의 귀엽고 발랄한 분위기를 담은 글꼴입니다.',
      publisher: '넥슨코리아',
      license: '메이플스토리 서체 사용조건',
    },
    [
      [
        300,
        'https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_20-04@2.1/MaplestoryOTFLight.woff',
      ],
      [700, 'https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_20-04@2.1/MaplestoryOTFBold.woff'],
    ]
  ),
  remoteFont(
    {
      name: 'RoundedFixedsys',
      displayName: '둥근모꼴',
      category: 'Display',
      description: '둥근모꼴과 Fixedsys를 조합해 옛 화면의 느낌을 살린 픽셀 글꼴입니다.',
      publisher: '길형진',
      license: 'Public Domain',
    },
    [[400, 'https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_six@1.2/DungGeunMo.woff']]
  ),
  remoteFont(
    {
      name: 'Shilla',
      displayName: '신라문화체',
      category: 'Display',
      description:
        '경주의 전통을 붓글씨의 질감으로 표현한 글꼴로, 일부 한글은 대체 글꼴로 보입니다.',
      publisher: '경주시',
      license: '공공누리 제1유형 (출처표시)',
    },
    [
      [
        500,
        'https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2206-02@1.0/Shilla_CultureM-Medium.woff2',
      ],
      [
        700,
        'https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2206-02@1.0/Shilla_CultureB-Bold.woff2',
      ],
    ]
  ),
  remoteFont(
    {
      name: 'PyeojinGothic',
      displayName: '펴진고딕',
      category: 'Sans',
      description: '프리텐다드의 곡선을 곧은 획으로 다듬은 중립적인 본문용 글꼴입니다.',
      publisher: '서지환 (엔파피)',
      license: 'SIL Open Font License 1.1',
    },
    [
      [300, `${PYEOJIN_SOURCE}/PyeojinGothic-Light.woff2`],
      [400, `${PYEOJIN_SOURCE}/PyeojinGothic-Regular.woff2`],
      [500, `${PYEOJIN_SOURCE}/PyeojinGothic-Medium.woff2`],
      [600, `${PYEOJIN_SOURCE}/PyeojinGothic-SemiBold.woff2`],
      [700, `${PYEOJIN_SOURCE}/PyeojinGothic-Bold.woff2`],
      [800, `${PYEOJIN_SOURCE}/PyeojinGothic-ExtraBold.woff2`],
      [900, `${PYEOJIN_SOURCE}/PyeojinGothic-Black.woff2`],
    ]
  ),
  remoteFont(
    {
      name: 'Soonbatang',
      displayName: '순바탕',
      category: 'Serif',
      description: '한국출판문화산업진흥원이 긴 글을 편안하게 읽도록 만든 본문용 바탕체입니다.',
      publisher: '한국출판문화산업진흥원',
      license: '순바탕 라이선스',
    },
    [
      [300, 'https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_eight@1.0/SunBatang-Light.woff'],
      [500, 'https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_eight@1.0/SunBatang-Medium.woff'],
      [700, 'https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_eight@1.0/SunBatang-Bold.woff'],
    ]
  ),
];

const categoryOrder: Record<FontCategory, number> = {
  System: 0,
  Sans: 1,
  Serif: 2,
  Calligraphy: 3,
  Display: 4,
};
const preferred: Partial<Record<FontCategory, string[]>> = {
  Sans: ['Freesentation', 'Pretendard', 'Noto Sans KR'],
  Serif: ['MaruBuri', 'RIDIBatang'],
};
const nameOrder = new Intl.Collator('ko', { numeric: true });
function preferredRank(font: FontData) {
  const order = preferred[font.category] ?? [];
  const index = order.indexOf(font.name);
  return index < 0 ? order.length : index;
}

export const FONTS: FontData[] = fontCatalog.sort(
  (left, right) =>
    categoryOrder[left.category] - categoryOrder[right.category] ||
    preferredRank(left) - preferredRank(right) ||
    nameOrder.compare(left.displayName, right.displayName) ||
    nameOrder.compare(left.name, right.name)
);
