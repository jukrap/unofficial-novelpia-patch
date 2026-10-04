import {
  getFontCatalog,
  getUserFonts,
  initializeUserFonts,
  readUserFontFace,
  subscribeFonts,
} from '@/shared/platform/user-fonts';
import type { Settings } from '@/shared/model/preferences';
export function supportedWeights(id: string) {
  return getFontCatalog().find((font) => font.name === id)?.metadata.weights ?? [400, 700];
}
export function supportsBold(id: string) {
  return supportedWeights(id).some((weight) => weight >= 600);
}
export function effectiveWeight(
  settings: Pick<Settings, 'fontFamily' | 'fontWeight' | 'forceBold'>
) {
  const target = settings.forceBold ? 700 : settings.fontWeight;
  if (settings.forceBold && !supportsBold(settings.fontFamily)) return 700;
  return supportedWeights(settings.fontFamily).reduce((best, next) =>
    Math.abs(next - target) < Math.abs(best - target) ? next : best
  );
}
/** Author emphasis uses a real heavier face when available, otherwise native synthetic bold. */
export function authorWeight(settings: Pick<Settings, 'fontFamily' | 'fontWeight' | 'forceBold'>) {
  if (!supportsBold(settings.fontFamily)) return 700;
  const target = effectiveWeight(settings) >= 600 ? 900 : 700;
  const weights = supportedWeights(settings.fontFamily);
  const heavier = weights.filter((weight) => weight >= target);
  return heavier.length ? Math.min(...heavier) : Math.max(...weights);
}
const aliases: Record<string, string> = {
  Pretendard: 'Pretendard Variable',
  'NanumSquare Neo': 'NanumSquareNeo',
  MaruBuri: '마루 부리',
  RIDIBatang: '리디바탕',
};
export const fontFamily = (id: string) =>
  id === 'system-ui'
    ? 'system-ui, sans-serif'
    : `"${(aliases[id] ?? id).replace(/["\\]/g, '')}", system-ui, sans-serif`;
const warmupText = '한글 ABC abc 0123456789';
/** The probe stays in the browser; it selects the font's required Unicode subsets. */
function fontSample(text = warmupText) {
  return [...new Set(` ${text.trim() ? text : warmupText}`)].join('');
}
export class FontLoader {
  private loads = new Map<string, Promise<void>>();
  private elements = new Map<string, HTMLElement>();
  private readyFaces = new Map<string, Map<number, Set<string>>>();
  private localFaces = new Map<string, FontFace[]>();
  private revisions = new Map<string, string>();
  private stopLibrary = subscribeFonts(() => {
    for (const [id, revision] of this.revisions) {
      if (getFontCatalog().find((font) => font.name === id)?.localRevision !== revision)
        this.clearLocal(id);
    }
  });
  private clearLocal(id: string) {
    this.localFaces.get(id)?.forEach((face) => document.fonts.delete(face));
    this.localFaces.delete(id);
    this.loads.delete(id);
    this.readyFaces.delete(id);
    this.revisions.delete(id);
  }
  private hasCoverage(id: string, weight: number, sample: string) {
    const ready = this.readyFaces.get(id)?.get(weight);
    return !!ready && [...sample].every((character) => ready.has(character));
  }
  isReadingReady(
    settings: Pick<Settings, 'fontFamily' | 'fontWeight' | 'forceBold'>,
    text?: string
  ) {
    const font = getFontCatalog().find((candidate) => candidate.name === settings.fontFamily);
    if (font?.localRevision && this.revisions.get(font.name) !== font.localRevision) return false;
    if (font?.isSystemFont) return true;
    const sample = fontSample(text);
    return [effectiveWeight(settings), authorWeight(settings)].every((weight) =>
      this.hasCoverage(settings.fontFamily, weight, sample)
    );
  }
  async loadReading(
    settings: Pick<Settings, 'fontFamily' | 'fontWeight' | 'forceBold' | 'fontSize'>,
    text?: string
  ) {
    if (settings.fontFamily.startsWith('unp-local-')) await initializeUserFonts();
    await Promise.all(
      [...new Set([effectiveWeight(settings), authorWeight(settings)])].map((weight) =>
        this.load(settings.fontFamily, weight, settings.fontSize, text)
      )
    );
  }
  load(id: string, weight: number, size: number, text?: string): Promise<void> {
    const font = getFontCatalog().find((f) => f.name === id);
    if (!font || font.isSystemFont)
      return font
        ? Promise.resolve()
        : Promise.reject(
            new Error(
              id.startsWith('unp-local-')
                ? '이 브라우저에 글꼴 파일이 없습니다. 설정 페이지의 사용자 글꼴에서 같은 파일을 다시 등록해 주세요.'
                : '저장된 글꼴을 찾지 못해 시스템 글꼴을 사용합니다.'
            )
          );
    if (font.localRevision && this.revisions.get(id) !== font.localRevision) {
      this.clearLocal(id);
      this.revisions.set(id, font.localRevision);
    }
    const sample = fontSample(text);
    if (this.hasCoverage(id, weight, sample)) return Promise.resolve();
    let pending = this.loads.get(id);
    if (!pending) {
      pending = font.localRevision
        ? this.loadLocal(id, font.localRevision, () => this.loads.get(id) === pending)
        : new Promise<void>((resolve, reject) => {
            const resource = font.urls[0];
            if (!resource) return resolve();
            if (resource.css) {
              const style = document.createElement('style');
              style.textContent = resource.css;
              style.dataset.unpFont = id;
              document.head.append(style);
              this.elements.set(id, style);
              resolve();
            } else {
              const link = document.createElement('link');
              link.rel = 'stylesheet';
              link.href = resource.url;
              link.dataset.unpFont = id;
              link.onload = () => resolve();
              link.onerror = () => reject(new Error('글꼴 파일을 불러오지 못했습니다.'));
              document.head.append(link);
              this.elements.set(id, link);
            }
          });
      this.loads.set(id, pending);
    }
    let timeout: ReturnType<typeof setTimeout>;
    return Promise.race([
      pending.then(async () => {
        const faces = await document.fonts.load(
          `${weight} ${size}px "${aliases[id] ?? id}"`,
          sample
        );
        if (!faces.length) throw new Error('이 글꼴을 적용하지 못해 대체 글꼴로 표시합니다.');
        if (this.loads.get(id) === pending) {
          let ready = this.readyFaces.get(id);
          if (!ready) this.readyFaces.set(id, (ready = new Map()));
          let characters = ready.get(weight);
          if (!characters) ready.set(weight, (characters = new Set()));
          for (const character of sample) characters.add(character);
        }
      }),
      new Promise<never>(
        (_, reject) =>
          (timeout = setTimeout(() => reject(new Error('글꼴 로딩이 지연되고 있습니다.')), 10000))
      ),
    ])
      .catch((error: unknown) => {
        // A rejected stylesheet/face or timed-out resource must not poison future
        // selections. Do not remove a newer retry that has already replaced it.
        if (this.loads.get(id) === pending) {
          this.loads.delete(id);
          this.readyFaces.delete(id);
          this.elements.get(id)?.remove();
          this.elements.delete(id);
          this.localFaces.get(id)?.forEach((face) => document.fonts.delete(face));
          this.localFaces.delete(id);
        }
        throw error;
      })
      .finally(() => clearTimeout(timeout));
  }
  private async loadLocal(id: string, revision: string, current: () => boolean) {
    const record = getUserFonts().find((font) => font.id === id);
    if (!record) throw new Error('등록 글꼴을 찾지 못했습니다.');
    const loaded: FontFace[] = [];
    try {
      for (const face of record.faces) {
        const bytes = await readUserFontFace(id, revision, face.id);
        const next = new FontFace(id, bytes, {
          weight: face.variable ? `${face.minWeight} ${face.maxWeight}` : String(face.weight),
          style: face.style,
          display: 'swap',
        });
        await next.load();
        loaded.push(next);
      }
      if (this.revisions.get(id) !== revision || !current())
        throw new Error('글꼴 불러오기가 취소되었습니다.');
      loaded.forEach((face) => document.fonts.add(face));
      this.localFaces.set(id, loaded);
    } catch (error) {
      loaded.forEach((face) => document.fonts.delete(face));
      throw error;
    }
  }
  dispose() {
    this.stopLibrary();
    this.localFaces.forEach((faces) => faces.forEach((face) => document.fonts.delete(face)));
    this.localFaces.clear();
    this.revisions.clear();
    this.elements.forEach((el) => el.remove());
    this.elements.clear();
    this.loads.clear();
    this.readyFaces.clear();
  }
}
