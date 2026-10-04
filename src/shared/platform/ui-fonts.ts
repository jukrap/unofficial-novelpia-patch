const family = 'UNP UI Freesentation';
const files = [
  [400, 'Freesentation-4Regular.woff2'],
  [500, 'Freesentation-5Medium.woff2'],
  [600, 'Freesentation-6SemiBold.woff2'],
  [700, 'Freesentation-7Bold.woff2'],
] as const;
const installed = new WeakMap<Document, { faces: FontFace[]; users: number }>();

/** Document-level faces also work in shadow roots. Only owned UI opts into this
 * family; registering a face neither restyles the site nor waits on the network. */
export function installUiFonts(doc = document) {
  let entry = installed.get(doc);
  if (!entry) {
    const faces: FontFace[] = [];
    try {
      for (const [weight, file] of files) {
        const source = chrome.runtime.getURL(`fonts/${file}`);
        const face = new FontFace(family, `url("${source}") format("woff2")`, {
          weight: String(weight),
          style: 'normal',
          display: 'swap',
        });
        doc.fonts.add(face);
        faces.push(face);
      }
    } catch {
      // An unavailable extension context keeps the UI on its system fallback.
      for (const face of faces) doc.fonts.delete(face);
      return () => {};
    }
    entry = { faces, users: 0 };
    installed.set(doc, entry);
  }
  entry.users++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--entry.users) return;
    for (const face of entry.faces) doc.fonts.delete(face);
    installed.delete(doc);
  };
}

/** Call after registration to prepare a small, owned surface before showing it. */
export async function loadUiFonts(doc = document, timeoutMs = 1500): Promise<boolean> {
  const entry = installed.get(doc);
  if (!entry?.faces.length) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.all(entry.faces.map((face) => face.load())).then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
