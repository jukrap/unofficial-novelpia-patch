const paths = {
  check: 'm5 12 4 4 10-10',
  plus: 'M5 12h14M12 5v14',
  minus: 'M5 12h14',
  close: 'M6 6l12 12M18 6 6 18',
  chevron: 'm7 10 5 5 5-5',
  book: 'M3 5c3-1 6-.5 9 1.5C15 4.5 18 4 21 5v15c-3-1-6-.5-9 1-3-1.5-6-2-9-1V5Zm9 1.5V21',
  presets: 'M5 3h14v18l-7-4-7 4V3Zm4 5h6M9 12h6',
  layout: 'M3 4h18v16H3V4Zm9 0v16M6 8h3M6 12h3M15 8h3M15 12h3',
  text: 'M4 5h16M12 5v15M8 20h8M4 5v3M20 5v3',
  appearance:
    'M12 3a9 9 0 1 0 9 9c0-2-2-3-4-3h-2a2 2 0 0 1-2-2V5c0-1-1-2-1-2ZM7 8h.01M6 13h.01M9 17h.01',
  reading: 'M4 7h16M4 17h16M8 4v6M16 14v6',
  lab: 'M9 3h6M10 3v7l-6 9a1.2 1.2 0 0 0 1 2h14a1.2 1.2 0 0 0 1-2l-6-9V3M7 16h10',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 11v6M12 7h.01',
  bookmark: 'M6 3h12v18l-6-4-6 4V3Z',
  restore: 'm9 5-5 5 5 5M4 10h9a6 6 0 0 1 0 12',
} as const;
export type IconName = keyof typeof paths;
export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
