export const emphasisShadow = (dark: boolean) =>
  dark ? '0 0 1px currentColor, 0 0 4px currentColor' : '0 0 1px currentColor, 1px 1px 3px #0005';

const luminance = (hex: string) => {
  const rgb = hex
    .replace('#', '')
    .match(/../g)
    ?.map((value) => {
      const n = parseInt(value, 16) / 255;
      return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
    }) ?? [0, 0, 0];
  return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
};
// Solid fills give the same contrast on a paper surface, an image, or a menu sample.
export function emphasisHighlight(textColor: string) {
  const foreground = luminance(textColor);
  const contrast = (color: string) => {
    const background = luminance(color);
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  };
  return contrast('#eadcff') >= contrast('#573873') ? '#eadcff' : '#573873';
}
