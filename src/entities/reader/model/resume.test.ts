import { afterEach, describe, expect, it } from 'vitest';
import type { ReadingAnchor } from './anchor';
import { readingGestureIntent, readingKeyIntent, ResumeSession, resumeAnchor } from './resume';
import type { ReaderRoots } from '../lib/site';

const saved: ReadingAnchor = { episodeId: '1001', blockKey: '8', textOffset: 42, edge: 'text' };

describe('automatic reading resume', () => {
  it('uses valid same-episode document, mode and automatic anchors in that order', () => {
    const document = { ...saved, blockKey: '11' };
    const mode = { ...saved, blockKey: '10' };
    expect(resumeAnchor('1001', document, mode, saved)).toEqual(document);
    expect(resumeAnchor('1001', null, mode, saved)).toEqual(mode);
    expect(resumeAnchor('1001', { ...document, episodeId: '1002' }, { bad: true }, saved)).toEqual(
      saved
    );
    expect(resumeAnchor('1002', undefined, null, saved)).toBeNull();
    expect(resumeAnchor('1001', { ...saved, textOffset: -1 })).toBeNull();
  });

  it('does not persist initial layout until a saved position has been read', () => {
    const session = new ResumeSession();
    expect(session.canSave).toBe(false);
    const ticket = session.begin();
    expect(session.canSave).toBe(false);
    expect(session.complete(ticket, saved)).toEqual({ anchor: saved, saveCurrent: false });
    expect(session.canSave).toBe(true);
  });

  it('keeps the starting screen when there is no valid automatic record', () => {
    const session = new ResumeSession();
    const ticket = session.begin();
    expect(session.complete(ticket, null)).toEqual({ anchor: null, saveCurrent: false });
    expect(session.canSave).toBe(true);
  });

  it('honors input during a pending read and permits saving before a quick departure', () => {
    const session = new ResumeSession();
    const ticket = session.begin();
    session.userIntent();
    expect(session.canSave).toBe(true);
    expect(session.complete(ticket, saved)).toEqual({ anchor: null, saveCurrent: true });
  });

  it('starts a fresh restoration session after a cached page returns', () => {
    const session = new ResumeSession();
    const first = session.begin();
    session.complete(first, saved);
    session.userIntent();
    const resumed = session.begin();
    const latest = { ...saved, blockKey: '20' };
    expect(session.canSave).toBe(false);
    expect(session.complete(resumed, latest)).toEqual({ anchor: latest, saveCurrent: false });
  });

  it('ignores a superseded response without opening the new session save gate', () => {
    const session = new ResumeSession();
    const old = session.begin();
    const current = session.begin();
    expect(session.complete(old, saved)).toBeNull();
    expect(session.canSave).toBe(false);
    session.userIntent();
    expect(session.complete(current, saved)).toEqual({ anchor: null, saveCurrent: true });
    expect(session.complete(current, saved)).toBeNull();
  });

  it('does not overwrite unread storage after a failed read without a new user action', () => {
    const session = new ResumeSession();
    const ticket = session.begin();
    expect(session.complete(ticket, null, false)).toEqual({ anchor: null, saveCurrent: false });
    expect(session.canSave).toBe(false);
    session.userIntent();
    expect(session.canSave).toBe(true);
  });
});

describe('resume input boundary', () => {
  afterEach(() => document.body.replaceChildren());
  const receive = (target: Element, event: Event, decide: (event: Event) => boolean) => {
    let result = false;
    window.addEventListener(
      event.type,
      (received) => {
        result = decide(received);
      },
      { once: true }
    );
    target.dispatchEvent(event);
    return result;
  };
  const setup = () => {
    document.body.innerHTML =
      '<div id="novel_box"><div id="novel_text"><div id="novel_drawing"><p>본문</p></div></div></div><div id="theme_box"><input></div><aside><button>광고</button></aside><div id="novel_drawing_right">다음 쪽</div><div class="curation-wrapper"><a href="#">추천 작품</a></div><div id="unp-navigation-host"><input type="range"></div>';
    const roots: ReaderRoots = {
      box: document.getElementById('novel_box')!,
      text: document.getElementById('novel_text')!,
      body: document.getElementById('novel_drawing')!,
      pageContainer: null,
      mode: 'scroll',
      episodeId: '1001',
    };
    const service = document.querySelector<HTMLElement>('.curation-wrapper')!;
    return { roots, decide: (event: Event) => readingGestureIntent(event, roots, service) };
  };

  it('ignores settings inputs, unrelated keys and advertisement clicks while a read is pending', () => {
    const { roots, decide } = setup();
    const session = new ResumeSession();
    const ticket = session.begin();
    const input = document.querySelector('input')!;
    for (const [target, event] of [
      [input, new WheelEvent('wheel', { bubbles: true, deltaY: 10 })],
      [document.querySelector('aside button')!, new MouseEvent('pointerdown', { bubbles: true })],
      [roots.body, new MouseEvent('pointerdown', { bubbles: true, clientX: 50, clientY: 50 })],
    ] as const)
      if (receive(target, event, decide)) session.userIntent();
    for (const [target, key] of [
      [input, 'ArrowDown'],
      [roots.body, 'Escape'],
      [roots.body, 'Enter'],
    ] as const)
      if (
        receive(target, new KeyboardEvent('keydown', { key, bubbles: true }), (event) =>
          readingKeyIntent(event as KeyboardEvent)
        )
      )
        session.userIntent();
    expect(session.canSave).toBe(false);
    expect(session.complete(ticket, saved)?.anchor).toEqual(saved);
  });

  it('accepts reader scrolling, recommendation wheel and native page controls, but not navigation inputs', () => {
    const { roots, decide } = setup();
    expect(
      receive(roots.body, new WheelEvent('wheel', { bubbles: true, deltaY: 100 }), decide)
    ).toBe(true);
    expect(
      receive(
        document.querySelector('.curation-wrapper a')!,
        new WheelEvent('wheel', { bubbles: true, deltaY: -100 }),
        decide
      )
    ).toBe(true);
    expect(
      receive(
        document.getElementById('novel_drawing_right')!,
        new MouseEvent('pointerdown', { bubbles: true }),
        decide
      )
    ).toBe(true);
    expect(
      receive(
        document.querySelector('#unp-navigation-host input')!,
        new MouseEvent('pointerdown', { bubbles: true }),
        decide
      )
    ).toBe(false);
    expect(
      receive(
        roots.body,
        new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }),
        (event) => readingKeyIntent(event as KeyboardEvent)
      )
    ).toBe(true);
  });

  it('lets middle-button autoscroll win even while the saved position is still loading', () => {
    const { roots, decide } = setup();
    const session = new ResumeSession();
    const ticket = session.begin();
    const event = new MouseEvent('pointerdown', { bubbles: true, button: 1 });
    if (receive(roots.body.querySelector('p')!, event, decide)) session.userIntent();
    expect(session.complete(ticket, saved)).toEqual({ anchor: null, saveCurrent: true });
    expect(event.defaultPrevented).toBe(false);
  });

  it('does not mistake middle clicks on links, controls, service UI or page mode for autoscroll', () => {
    const { roots, decide } = setup();
    roots.body.insertAdjacentHTML('beforeend', '<a href="/other">회차</a><button>버튼</button>');
    for (const target of [
      roots.body.querySelector('a')!,
      roots.body.querySelector('button')!,
      document.querySelector('#theme_box input')!,
      document.querySelector('aside button')!,
      document.querySelector('.curation-wrapper a')!,
    ])
      expect(
        receive(target, new MouseEvent('pointerdown', { bubbles: true, button: 1 }), decide)
      ).toBe(false);
    roots.mode = 'page';
    expect(
      receive(roots.body, new MouseEvent('pointerdown', { bubbles: true, button: 1 }), decide)
    ).toBe(false);
    roots.mode = 'scroll';
    expect(
      receive(roots.body, new MouseEvent('pointerdown', { bubbles: true, button: 2 }), decide)
    ).toBe(false);
  });
});
