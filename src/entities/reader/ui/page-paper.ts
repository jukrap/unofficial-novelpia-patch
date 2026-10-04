/** Owned backdrop paint only. No site DOM, advertisement or interactive surface is copied. */
export interface PageBackdrop {
  color: string;
  layers: {
    view: DOMRect;
    image: string;
    color: string;
    size: string;
    position: string;
    repeat: string;
    opacity: string;
  }[];
}

/** Composite a translucent sheet against the reader background, never another
 * page's text. The resulting backing is opaque but has the same resting pixels
 * as the configured alpha paper over its color/image background. */
export function pagePaper(view: DOMRect, paper: string, backdrop: PageBackdrop): HTMLElement {
  const backing = document.createElement('div');
  backing.dataset.unpPaperBackdrop = '';
  backing.style.cssText = `position:absolute;inset:0;overflow:hidden;pointer-events:none;background:${backdrop.color};`;
  for (const layer of backdrop.layers) {
    const paint = document.createElement('div');
    Object.assign(paint.style, {
      position: 'absolute',
      left: `${layer.view.left - view.left}px`,
      top: `${layer.view.top - view.top}px`,
      width: `${layer.view.width}px`,
      height: `${layer.view.height}px`,
      backgroundImage: layer.image,
      backgroundColor: layer.color,
      backgroundSize: layer.size,
      backgroundPosition: layer.position,
      backgroundRepeat: layer.repeat,
      opacity: layer.opacity,
    });
    backing.append(paint);
  }
  const tint = document.createElement('div');
  tint.style.cssText = `position:absolute;inset:0;background:${paper};`;
  backing.append(tint);
  return backing;
}
