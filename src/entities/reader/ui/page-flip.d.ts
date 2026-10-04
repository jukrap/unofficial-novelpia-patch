declare module 'page-flip/dist/js/page-flip.module.js' {
  export class PageFlip {
    constructor(element: HTMLElement, settings: Record<string, string | number | boolean>);
    loadFromHTML(pages: HTMLElement[]): void;
    on(event: string, callback: (event: { data: unknown }) => void): this;
    off(event: string): void;
    flipNext(corner?: 'top' | 'bottom'): void;
    flipPrev(corner?: 'top' | 'bottom'): void;
    destroy(): void;
  }
}
