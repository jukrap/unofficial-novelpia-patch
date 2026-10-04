import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaults } from '@/shared/model/preferences';
import { resolveBackgroundImage } from '@/shared/platform/background-assets';
import { ReaderBackground } from './background-layer';

vi.mock('@/shared/platform/background-assets', () => ({ resolveBackgroundImage: vi.fn() }));
afterEach(() => {
  vi.clearAllMocks();
  document.body.replaceChildren();
});

describe('reader background ownership', () => {
  it('releases a late decoded image instead of replacing the newer selection', async () => {
    const box = document.createElement('div');
    document.body.append(box);
    const oldRelease = vi.fn();
    const nextRelease = vi.fn();
    let oldReady!: (value: { url: string; release: () => void }) => void;
    vi.mocked(resolveBackgroundImage)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            oldReady = resolve;
          })
      )
      .mockResolvedValueOnce({ url: 'blob:new', release: nextRelease });
    const settings = {
      ...defaults,
      backgroundType: 'image' as const,
      backgroundImage: 'https://example.com/old.png',
      backgroundImageFade: false,
    };
    const report = vi.fn();
    const layer = new ReaderBackground(box, settings, report);
    layer.update(settings);
    layer.update({ ...settings, backgroundImage: 'https://example.com/new.png' });
    await Promise.resolve();
    oldReady({ url: 'blob:old', release: oldRelease });
    await Promise.resolve();
    expect(document.querySelector('[data-unp-background]')?.getAttribute('style')).toContain(
      'blob:new'
    );
    expect(box.querySelector('[data-unp-background]')).toBeNull();
    expect(oldRelease).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenLastCalledWith('ready', '');
    layer.dispose();
    expect(nextRelease).toHaveBeenCalledTimes(1);
    expect(box.children).toHaveLength(0);
    expect(document.querySelector('[data-unp-background]')).toBeNull();
  });
  it('falls back to solid color on failure and does not repeatedly fetch on layout', async () => {
    const box = document.createElement('div');
    document.body.append(box);
    vi.mocked(resolveBackgroundImage).mockRejectedValueOnce(new Error('이미지 다시 등록'));
    const settings = {
      ...defaults,
      backgroundType: 'image' as const,
      backgroundImageSource: 'file' as const,
      backgroundAssetId: 'missing',
      backgroundImageFade: false,
    };
    const report = vi.fn();
    const layer = new ReaderBackground(box, settings, report);
    layer.update(settings);
    layer.update(settings);
    await Promise.resolve();
    await Promise.resolve();
    expect(resolveBackgroundImage).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenLastCalledWith('error', '이미지 다시 등록');
    expect(box.children).toHaveLength(0);
    layer.dispose();
  });
  it('places the image outside the scrolling containing block and restores owned paint styles', async () => {
    const parent = document.createElement('div');
    const box = document.createElement('div');
    parent.append(box);
    document.body.append(parent);
    parent.style.isolation = 'auto';
    box.style.cssText = 'position:relative;will-change:transform;filter:blur(0px);contain:paint';
    const original = box.getAttribute('style');
    for (const [name, value] of Object.entries({
      offsetTop: 42,
      offsetLeft: 20,
      clientTop: 2,
      clientLeft: 3,
      clientWidth: 760,
      clientHeight: 480,
    }))
      Object.defineProperty(box, name, { configurable: true, value });
    vi.spyOn(box, 'getClientRects').mockReturnValue([
      new DOMRect(20, 42, 780, 500),
    ] as unknown as DOMRectList);
    const release = vi.fn();
    vi.mocked(resolveBackgroundImage).mockResolvedValueOnce({ url: 'blob:viewport', release });
    const settings = {
      ...defaults,
      backgroundType: 'image' as const,
      backgroundImage: 'https://example.com/viewport.png',
      backgroundImageFade: false,
    };
    const background = new ReaderBackground(box, settings, vi.fn());
    background.update(settings);
    await Promise.resolve();
    const image = parent.querySelector<HTMLElement>('[data-unp-background]')!;
    expect(image.parentElement).toBe(parent);
    expect(image.nextElementSibling).toBe(box);
    expect(image.style.position).toBe('absolute');
    expect(image.style.left).toBe('23px');
    expect(image.style.top).toBe('44px');
    expect(image.style.width).toBe('760px');
    expect(image.style.height).toBe('480px');
    expect(parent.style.isolation).toBe('isolate');
    expect(box.style.getPropertyValue('--unp-background-color')).toBe('transparent');
    box.scrollTop = 2200;
    background.update(settings);
    expect(image.style.top).toBe('44px');
    expect(box.style.willChange).toBe('transform');
    expect(box.style.contain).toBe('paint');
    expect(box.style.filter).toBe('blur(0px)');
    background.dispose();
    expect(release).toHaveBeenCalledTimes(1);
    expect(parent.style.isolation).toBe('auto');
    expect(box.getAttribute('style')).toBe(original);
    expect(parent.children).toHaveLength(1);
  });
});
