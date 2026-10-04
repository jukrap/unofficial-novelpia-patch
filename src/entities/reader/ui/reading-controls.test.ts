import { afterEach, expect, it, vi } from 'vitest';
import { defaults as currentDefaults } from '@/shared/model/preferences';
import { ReadingControls } from './reading-controls';

const defaults = { ...currentDefaults, readingSurfaces: 'default' as const };
const surfaceIds = [
  'writer_comments_box',
  'next_epi_btn_bottom',
  'next_info_layer',
  'back_info_layer',
];
const nativeStyle =
  'color:red;background:rgba(155,155,155,.1) url("https://example.com/native.png");border:2px dotted gold;box-shadow:1px 2px 3px red;opacity:.4;display:none';

function fixture() {
  document.body.innerHTML =
    surfaceIds.map((id) => `<div id="${id}"><b>합성 내용</b></div>`).join('') +
    '<aside data-service="ad" style="background:gold">합성 광고</aside>' +
    '<div data-extension-toast style="background:purple;color:white">설정을 복사했습니다</div>';
  const surfaces = surfaceIds.map((id) => document.getElementById(id)!) as [
    HTMLElement,
    HTMLElement,
    HTMLElement,
    HTMLElement,
  ];
  for (const element of surfaces) element.style.cssText = nativeStyle;
  return surfaces;
}

function nativePaint(element: HTMLElement) {
  return {
    color: element.style.color,
    backgroundColor: element.style.backgroundColor,
    backgroundImage: element.style.backgroundImage,
    border: ['top', 'right', 'bottom', 'left'].map((side) =>
      ['width', 'style', 'color'].map((part) =>
        element.style.getPropertyValue(`border-${side}-${part}`)
      )
    ),
    shadow: element.style.boxShadow,
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

it('leaves native paint intact in default mode while keeping improved hint placement', () => {
  const surfaces = fixture();
  const before = surfaces.map(nativePaint);
  const controls = new ReadingControls();
  controls.update({ ...defaults, textColor: '#001122', textAreaBackgroundColor: '#aabbcc' });
  expect(surfaces.map(nativePaint)).toEqual(before);
  expect(surfaces[2].style.width).toBe('300px');
  expect(surfaces[2].style.left).toBe('50%');
  expect(surfaces[0].style.width).toBe('');
  controls.dispose();
  expect(surfaces[2].style.width).toBe('');
  expect(surfaces.map(nativePaint)).toEqual(before);
});

it.each([
  ['translucent', false, 'rgb(250, 240, 220)', 'rgba(32, 24, 48, 0.8)'],
  ['translucent', true, 'rgb(250, 240, 220)', 'rgba(32, 24, 48, 0.8)'],
  ['opaque', false, 'rgb(250, 240, 220)', 'rgb(32, 24, 48)'],
  ['opaque', true, 'rgb(250, 240, 220)', 'rgb(32, 24, 48)'],
  ['theme', false, 'rgb(41, 38, 48)', 'rgb(255, 255, 255)'],
  ['theme', true, 'rgb(241, 237, 247)', 'rgb(36, 33, 42)'],
] as const)(
  'applies %s paint to all reading surfaces with dark mode %s',
  (mode, dark, ink, paper) => {
    const surfaces = fixture();
    const controls = new ReadingControls();
    const service = document.querySelector('aside')!.outerHTML;
    const toast = document.querySelector('[data-extension-toast]')!.outerHTML;
    const click = vi.fn();
    surfaces[1].addEventListener('click', click);
    controls.update({
      ...defaults,
      readingSurfaces: mode,
      darkMode: dark,
      textAreaBackgroundColor: '#201830',
      textColor: '#faf0dc',
    });
    for (const element of surfaces) {
      expect(element.style.color).toBe(ink);
      expect(element.style.backgroundColor).toBe(paper);
      expect(element.style.backgroundImage).toBe('none');
      expect(element.style.opacity).toBe('0.4');
      expect(element.style.display).toBe('none');
    }
    if (mode === 'theme')
      expect(surfaces[2].style.borderTopColor).toBe(
        dark ? 'rgb(121, 112, 130)' : 'rgb(186, 185, 198)'
      );
    surfaces[1].click();
    expect(click).toHaveBeenCalledOnce();
    expect(document.querySelector('aside')!.outerHTML).toBe(service);
    expect(document.querySelector('[data-extension-toast]')!.outerHTML).toBe(toast);
    controls.dispose();
  }
);

it('restores native paint after repeated mode and color changes without undoing native fades', () => {
  const surfaces = fixture();
  const before = surfaces.map(nativePaint);
  const controls = new ReadingControls();
  for (const readingSurfaces of ['opaque', 'translucent', 'theme', 'opaque'] as const) {
    controls.update({ ...defaults, readingSurfaces });
    controls.update({ ...defaults, readingSurfaces, textColor: '#c0ffee', darkMode: true });
  }
  surfaces[2].style.opacity = '0.7';
  surfaces[2].style.display = 'block';
  controls.update(defaults);
  expect(surfaces.map(nativePaint)).toEqual(before);
  expect(surfaces[2].style.width).toBe('300px');
  expect(surfaces[2].style.opacity).toBe('0.7');
  expect(surfaces[2].style.display).toBe('block');
  controls.dispose();
  expect(surfaces[2].style.opacity).toBe('0.7');
  expect(surfaces[2].style.display).toBe('block');
});

it('retains native paint changes made while extension colors are active', () => {
  const [note, , hint] = fixture();
  const controls = new ReadingControls();
  controls.update({ ...defaults, readingSurfaces: 'opaque' });
  note.style.setProperty('color', 'blue', 'important');
  note.style.backgroundColor = 'green';
  hint.style.border = '3px dashed blue';
  hint.style.boxShadow = '1px 1px 1px blue';
  controls.update({ ...defaults, readingSurfaces: 'theme' });
  // A later native write that has not been reapplied must also remain intact.
  note.style.backgroundImage = 'url("https://example.com/updated.png")';
  controls.update(defaults);
  expect(note.style.color).toBe('blue');
  expect(note.style.getPropertyPriority('color')).toBe('important');
  expect(note.style.backgroundColor).toBe('green');
  expect(note.style.backgroundImage).toContain('updated.png');
  expect(hint.style.borderTopWidth).toBe('3px');
  expect(hint.style.borderTopStyle).toBe('dashed');
  expect(hint.style.borderTopColor).toBe('blue');
  expect(hint.style.boxShadow).toBe('1px 1px 1px blue');
  controls.dispose();
});

it('styles replaced native nodes and restores each node to its own paint', () => {
  const [original] = fixture();
  const controls = new ReadingControls();
  controls.update({ ...defaults, readingSurfaces: 'theme' });
  const replacement = document.createElement('div');
  replacement.id = original.id;
  replacement.style.cssText = 'color:green;background:navy;border:4px solid silver';
  const before = nativePaint(replacement);
  original.replaceWith(replacement);
  controls.update({ ...defaults, readingSurfaces: 'translucent' });
  expect(replacement.style.backgroundColor).toBe('rgba(255, 255, 255, 0.8)');
  controls.update(defaults);
  expect(nativePaint(replacement)).toEqual(before);
  expect(original.style.color).toBe('red');
  controls.dispose();
});

it('restores asymmetric native borders and does not leave paint when the original used stylesheets', () => {
  const [note, , hint] = fixture();
  note.style.cssText = '';
  hint.style.cssText =
    'border-top:2px dotted red;border-right:3px solid green;border-bottom:4px dashed blue';
  const before = [note, hint].map(nativePaint);
  const controls = new ReadingControls();
  controls.update({ ...defaults, readingSurfaces: 'opaque' });
  controls.dispose();
  expect([note, hint].map(nativePaint)).toEqual(before);
});

it.each([
  ['default', false, 'red', 'rgba(155, 155, 155, 0.1)'],
  ['translucent', false, 'rgb(250, 240, 220)', 'rgba(32, 24, 48, 0.8)'],
  ['opaque', true, 'rgb(250, 240, 220)', 'rgb(32, 24, 48)'],
  ['theme', false, 'rgb(41, 38, 48)', 'rgb(255, 255, 255)'],
  ['theme', true, 'rgb(241, 237, 247)', 'rgb(36, 33, 42)'],
] as const)(
  'paints the native loader and anonymous footers in %s mode (dark: %s)',
  (readingSurfaces, darkMode, ink, paper) => {
    document.body.innerHTML = `
      <div id="load_bar" style="display:none;opacity:.4"><br><br><br><div>소설 내용을 불러오고 있습니다.</div></div>
      <div id="novel_drawing"><p class="line">합성 본문</p><div class="curation-wrapper">광고</div><div>여기까지가 공지 마지막 내용입니다.</div></div>
      <div id="novel_drawing_page"><p class="line">합성 본문</p><div>  등록된 마지막 회차입니다  </div></div>`;
    const loader = document.querySelector<HTMLElement>('#load_bar')!;
    const elements = [
      loader.querySelector('div')!,
      document.querySelector<HTMLElement>('#novel_drawing > div:last-child')!,
      document.querySelector<HTMLElement>('#novel_drawing_page > div')!,
    ];
    for (const element of elements) element.style.cssText = nativeStyle;
    const before = elements.map(nativePaint);
    const click = vi.fn();
    loader.addEventListener('click', click);
    const controls = new ReadingControls();
    controls.update({
      readingSurfaces,
      darkMode,
      textColor: '#faf0dc',
      textAreaBackgroundColor: '#201830',
    });
    for (const element of elements) {
      expect(element.style.color).toBe(ink);
      expect(element.style.backgroundColor).toBe(paper);
      expect(element.style.display).toBe('none');
      expect(element.style.opacity).toBe('0.4');
    }
    expect(loader.style.backgroundColor).toBe('');
    expect(loader.style.opacity).toBe('0.4');
    loader.style.opacity = '0.8';
    loader.style.display = 'block';
    loader.click();
    expect(click).toHaveBeenCalledOnce();
    controls.dispose();
    expect(elements.map(nativePaint)).toEqual(before);
    expect(loader.style.opacity).toBe('0.8');
    expect(loader.style.display).toBe('block');
  }
);

it('handles loading before a reader exists and restores each replaced loader', () => {
  document.body.innerHTML = '<div id="load_bar"><div>소설 내용을 불러오고 있습니다.</div></div>';
  const controls = new ReadingControls();
  const loader = document.querySelector<HTMLElement>('#load_bar > div')!;
  loader.style.cssText = 'color:gold;background:navy';
  const before = nativePaint(loader);
  controls.update({ ...defaults, readingSurfaces: 'theme' });
  expect(loader.style.color).toBe('rgb(41, 38, 48)');
  const replacement = document.createElement('div');
  replacement.textContent = loader.textContent;
  replacement.style.cssText = 'color:blue;background:yellow';
  const replacementBefore = nativePaint(replacement);
  loader.replaceWith(replacement);
  controls.update({ ...defaults, readingSurfaces: 'opaque' });
  expect(nativePaint(loader)).toEqual(before);
  expect(replacement.style.color).toBe('rgb(0, 0, 0)');
  controls.update(defaults);
  expect(nativePaint(replacement)).toEqual(replacementBefore);
  controls.dispose();
});

it('does not style prose, nested matches, service content, or unknown notices as footers', () => {
  document.body.innerHTML = `
    <div>여기까지가 공지 마지막 내용입니다.</div>
    <div id="novel_drawing">
      <div>여기까지가 공지 마지막 내용입니다.</div>
      <div class="line">여기까지가 공지 마지막 내용입니다.</div>
      <div class="line"><div>등록된 마지막 회차입니다.</div></div>
      <div class="curation-wrapper"><div>등록된 마지막 회차입니다.</div></div>
      <div><span data-service="ad">등록된 마지막 회차입니다.</span></div>
      <div data-service="payment">등록된 마지막 회차입니다.</div>
      <div><div>여기까지가 공지 마지막 내용입니다.</div><div>다른 내용</div></div>
      <div>여기까지가 공지 마지막 내용입니다. 다음 내용을 기다려 주세요.</div>
      <div>다른 안내</div>
    </div>
    <div id="novel_drawing_page"><div>등록된 마지막 회차입니다.</div></div>`;
  const before = document.body.innerHTML;
  const controls = new ReadingControls();
  controls.update({ ...defaults, readingSurfaces: 'theme' });
  expect(document.body.innerHTML).toBe(before);
  controls.dispose();
});

it('restores a footer if native content is repurposed or moved into a service region', () => {
  document.body.innerHTML = `
    <div id="novel_drawing"><p class="line">합성 본문</p><div>여기까지가 공지 마지막 내용입니다!</div><div class="curation-wrapper"></div></div>`;
  const footer = document.querySelector<HTMLElement>('#novel_drawing > div')!;
  footer.style.cssText = nativeStyle;
  const before = nativePaint(footer);
  const controls = new ReadingControls();
  const settings = { ...defaults, readingSurfaces: 'theme' as const };
  controls.update(settings);
  expect(footer.style.color).toBe('rgb(41, 38, 48)');
  footer.textContent = '합성 일반 문장';
  controls.update(settings);
  expect(nativePaint(footer)).toEqual(before);
  footer.textContent = '등록된 마지막 회차입니다.';
  controls.update(settings);
  expect(footer.style.color).toBe('rgb(41, 38, 48)');
  document.querySelector('.curation-wrapper')!.append(footer);
  controls.update(settings);
  expect(nativePaint(footer)).toEqual(before);
  controls.dispose();
});

it.each([
  ['default', false, 'red', 'rgba(155, 155, 155, 0.1)'],
  ['translucent', false, 'rgb(250, 240, 220)', 'rgba(32, 24, 48, 0.8)'],
  ['opaque', true, 'rgb(250, 240, 220)', 'rgb(32, 24, 48)'],
  ['theme', false, 'rgb(41, 38, 48)', 'rgb(255, 255, 255)'],
  ['theme', true, 'rgb(241, 237, 247)', 'rgb(36, 33, 42)'],
] as const)(
  'colors only the native cover toggle in %s mode (dark: %s)',
  (readingSurfaces, darkMode, ink, paper) => {
    const cover =
      '<div class="cover-wrapper" style="color:green;background:gold"><img class="cover-img cover-no" style="max-width:100%" src="https://example.com/cover.png"><div class="cover-text">커버보기 <i class="icon ion-ios-arrow-down"></i></div></div>';
    document.body.innerHTML = `
      <div id="novel_drawing"><div class="line">${cover}</div></div>
      <div id="novel_drawing_page">${cover}</div>
      <div data-service="ad">${cover}</div>`;
    const controls = new ReadingControls();
    const service = document.querySelector('[data-service]')!.outerHTML;
    const wrappers = [
      ...document.querySelectorAll<HTMLElement>(
        '#novel_drawing .cover-wrapper, #novel_drawing_page .cover-wrapper'
      ),
    ];
    const buttons = wrappers.map((wrapper) => wrapper.querySelector<HTMLElement>('.cover-text')!);
    const images = wrappers.map((wrapper) => wrapper.querySelector<HTMLImageElement>('img')!);
    const wrapperStyles = wrappers.map((wrapper) => wrapper.style.cssText);
    const imageHtml = images.map((image) => image.outerHTML);
    for (const button of buttons) button.style.cssText = nativeStyle;
    const before = buttons.map(nativePaint);
    const clicked = vi.fn(() => {
      images[0]!.classList.remove('cover-no');
      buttons[0]!.innerHTML = '커버접기 <i class="icon ion-ios-arrow-up"></i>';
    });
    buttons[0]!.addEventListener('click', clicked);
    const settings = {
      readingSurfaces,
      darkMode,
      textColor: '#faf0dc',
      textAreaBackgroundColor: '#201830',
    };
    controls.update(settings);
    expect(wrappers.map((wrapper) => wrapper.style.cssText)).toEqual(wrapperStyles);
    expect(images.map((image) => image.outerHTML)).toEqual(imageHtml);
    expect(document.querySelector('[data-service]')!.outerHTML).toBe(service);
    for (const button of buttons) {
      expect(button.style.color).toBe(ink);
      expect(button.style.backgroundColor).toBe(paper);
    }
    buttons[0]!.click();
    controls.update(settings);
    expect(clicked).toHaveBeenCalledOnce();
    expect(buttons[0]!.textContent?.trim()).toBe('커버접기');
    expect(buttons[0]!.style.color).toBe(ink);
    expect(images[0]!.classList.contains('cover-no')).toBe(false);
    controls.dispose();
    expect(buttons.map(nativePaint)).toEqual(before);
    expect(buttons[0]!.textContent?.trim()).toBe('커버접기');
    expect(images[0]!.classList.contains('cover-no')).toBe(false);
  }
);

it('does not paint a cover-like control inside a service region in the native body', () => {
  document.body.innerHTML = `<div id="novel_drawing"><div class="curation-wrapper"><div class="cover-wrapper"><img src="https://example.com/ad.png"><div class="cover-text">커버보기</div></div></div></div>`;
  const before = document.body.innerHTML;
  const controls = new ReadingControls();
  controls.update({ ...defaults, readingSurfaces: 'theme' });
  expect(document.body.innerHTML).toBe(before);
  controls.dispose();
});
