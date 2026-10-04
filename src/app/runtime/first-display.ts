import type { ReaderEngine, FontLoader } from '@/entities/reader';
import type { Settings } from '@/shared/model/preferences';
import { resolveBackgroundImage } from '@/shared/platform/background-assets';
import type { ViewerPreparation } from './bootstrap';

/** A document has one reveal; later font/image changes never hide already readable text. */
export class FirstDisplay {
  private reader: ReaderEngine | null = null;
  private unsubscribe = () => {};
  private restored = false;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private frame = 0;
  private finalFrame = 0;
  private disposed = false;
  private resourceRequest: AbortController | undefined;
  private resourceKey = '';
  constructor(
    private preparation: ViewerPreparation | undefined,
    private fonts: FontLoader
  ) {}
  warm(settings: Settings) {
    void this.fonts.loadReading(settings).catch(() => {});
    const key = JSON.stringify([
      settings.backgroundType,
      settings.backgroundImageSource,
      settings.backgroundAssetId,
      settings.backgroundImage,
    ]);
    if (key === this.resourceKey) return;
    this.resourceKey = key;
    this.resourceRequest?.abort();
    const request = new AbortController();
    this.resourceRequest = request;
    void resolveBackgroundImage(settings, request.signal)
      .then((image) => image?.release())
      .catch(() => {});
  }
  attach(reader: ReaderEngine, restored: Promise<void>) {
    this.unsubscribe();
    this.clearFrames();
    this.reader = reader;
    this.restored = false;
    this.unsubscribe = reader.subscribe(this.check);
    const finishRestore = () => {
      if (this.disposed || this.reader !== reader) return;
      this.restored = true;
      this.check();
    };
    void restored.then(finishRestore, finishRestore);
    this.check();
  }
  private check = () => {
    if (this.disposed || !this.reader) return;
    const state = this.reader.getSnapshot();
    if (state.presentationReady) return;
    if (state.error && !state.readingFrame) {
      this.preparation?.reveal();
      return;
    }
    if (!state.readingFrame) return;
    // The engine's colors/geometry are committed before cached paint is retired.
    this.preparation?.handoffPaint();
    if (this.preparation?.revealed !== false) {
      this.reader.present();
      return;
    }
    this.deadline ??= setTimeout(() => this.reveal(), 3000);
    const ready =
      this.restored &&
      state.fontLoadState !== 'idle' &&
      state.fontLoadState !== 'loading' &&
      state.backgroundStatus !== 'loading';
    if (!ready) {
      this.clearFrames();
      return;
    }
    if (this.frame || this.finalFrame) return;
    // Font completion and resume restoration can each queue a new layout. Let that
    // layout paint atomically with the reveal, without exposing its previous geometry.
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.finalFrame = requestAnimationFrame(() => {
        this.finalFrame = 0;
        const latest = this.reader?.getSnapshot();
        if (
          latest &&
          this.restored &&
          latest.fontLoadState !== 'loading' &&
          latest.backgroundStatus !== 'loading'
        )
          this.reveal();
      });
    });
  };
  private reveal() {
    if (this.disposed || !this.reader) return;
    this.clearFrames();
    clearTimeout(this.deadline);
    this.preparation?.reveal();
    this.reader.present();
  }
  private clearFrames() {
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this.finalFrame);
    this.frame = this.finalFrame = 0;
  }
  dispose() {
    this.disposed = true;
    this.unsubscribe();
    this.clearFrames();
    clearTimeout(this.deadline);
    this.resourceRequest?.abort();
    this.preparation?.dispose();
  }
}
