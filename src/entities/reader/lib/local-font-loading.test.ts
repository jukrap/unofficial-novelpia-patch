import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ read: vi.fn(), revision: 'one' }));
vi.mock('@/shared/platform/user-fonts', () => ({
  getFontCatalog: () => [
    { name: 'unp-local-test', localRevision: mocks.revision, metadata: { weights: [400, 700] } },
  ],
  getUserFonts: () => [
    {
      id: 'unp-local-test',
      revision: mocks.revision,
      faces: [{ id: 'file', weight: 400, minWeight: 400, maxWeight: 400, style: 'normal' }],
    },
  ],
  initializeUserFonts: () => Promise.resolve(),
  subscribeFonts: () => () => {},
  readUserFontFace: mocks.read,
}));
import { FontLoader } from './fonts';
const original = Object.getOwnPropertyDescriptor(document, 'fonts');
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  mocks.read.mockReset();
  mocks.revision = 'one';
  if (original) Object.defineProperty(document, 'fonts', original);
  else Reflect.deleteProperty(document, 'fonts');
});
function setup() {
  const faces = new Set<object>();
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: {
      add: (face: object) => faces.add(face),
      delete: (face: object) => faces.delete(face),
      load: vi.fn().mockResolvedValue([{}]),
    },
  });
  vi.stubGlobal(
    'FontFace',
    class {
      load() {
        return Promise.resolve(this);
      }
    }
  );
  return faces;
}
it('does not install a timed-out local face after a same-revision retry', async () => {
  vi.useFakeTimers();
  const faces = setup();
  let complete!: (value: ArrayBuffer) => void;
  mocks.read
    .mockImplementationOnce(
      () =>
        new Promise<ArrayBuffer>((resolve) => {
          complete = resolve;
        })
    )
    .mockResolvedValue(new ArrayBuffer(1));
  const loader = new FontLoader();
  const failed = expect(loader.load('unp-local-test', 400, 18)).rejects.toThrow('지연');
  await vi.advanceTimersByTimeAsync(10000);
  await failed;
  await loader.load('unp-local-test', 400, 18);
  expect(faces.size).toBe(1);
  complete(new ArrayBuffer(1));
  await vi.advanceTimersByTimeAsync(0);
  expect(faces.size).toBe(1);
  loader.dispose();
  expect(faces.size).toBe(0);
});
it('replaces revised files and removes only the loader-owned faces on disposal', async () => {
  const faces = setup();
  const unrelated = {};
  faces.add(unrelated);
  mocks.read.mockResolvedValue(new ArrayBuffer(1));
  const loader = new FontLoader();
  await loader.load('unp-local-test', 400, 18);
  const previous = [...faces].find((face) => face !== unrelated)!;
  mocks.revision = 'two';
  expect(
    loader.isReadingReady({ fontFamily: 'unp-local-test', fontWeight: 400, forceBold: false })
  ).toBe(false);
  await loader.load('unp-local-test', 400, 18);
  expect(faces.has(previous)).toBe(false);
  expect(faces.size).toBe(2);
  loader.dispose();
  expect([...faces]).toEqual([unrelated]);
});
