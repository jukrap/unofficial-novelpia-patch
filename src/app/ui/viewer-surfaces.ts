/** Palette adapter only. Episode retrieval, sorting, badges and navigation remain site-owned. */
export class EpisodeListTheme {
  private sheet = document.createElement('style');
  private root: HTMLElement | null = null;
  private previous: string | null = null;
  constructor() {
    this.sheet.id = 'unp-episode-list-theme';
    this.sheet.textContent = `
#list_box[data-unp-theme]{background:#faf9fc!important;color:#292532!important;filter:none!important;--unp-list-ink:#292532;--unp-list-muted:#686171;--unp-list-line:#ddd7e5;--unp-list-soft:#eeeaf4}
#list_box[data-unp-theme="dark"]{background:#24212b!important;color:#eeeaf4!important;--unp-list-ink:#eeeaf4;--unp-list-muted:#beb5ca;--unp-list-line:#48404f;--unp-list-soft:#302b38}
#list_box[data-unp-theme] :is(table,td,b,font,.ep_style2){color:var(--unp-list-ink)!important}
#list_box[data-unp-theme] :is(.ep_style2,.ep_style3) :is(font,span):not([class*="b_"]){color:var(--unp-list-muted)!important}
#list_box[data-unp-theme] .ep_style2{background:var(--unp-list-soft)!important;opacity:1!important}
#list_box[data-unp-theme] .ep_style2 font{font-weight:400!important}
#list_box[data-unp-theme] .ep_style2 font>span:first-child{background:transparent!important;border-color:var(--unp-list-line)!important}
#list_box[data-unp-theme] :is(tr,td,hr){border-color:var(--unp-list-line)!important}
#list_box[data-unp-theme] :is(.b_19,.b_free,.b_plus,.b_comp,.b_mono,.b_cont,img){filter:none!important}
#list_box[data-unp-theme="dark"] .episode_title{filter:brightness(0) invert(1)!important}
#list_box[data-unp-theme="dark"] :is(.sort_down,.sort_up,.btn-pagenum-search img,.select_episode_box .close-x){filter:invert(1) hue-rotate(180deg)!important}
#list_box[data-unp-theme="dark"] :is(.sort_down,.sort_up):not([src*="_on"]){filter:brightness(0) invert(.7)!important}
#list_box[data-unp-theme="light"] :is(.sort_down,.sort_up):not([src*="_on"]){filter:brightness(.6)!important}
#list_box[data-unp-theme] :is(.select_episode_box,.select_episode_box input,.btn-pagenum-search){background:var(--unp-list-soft)!important;color:var(--unp-list-ink)!important;border-color:var(--unp-list-line)!important}
#list_box[data-unp-theme] .pagination :is(a,span){color:var(--unp-list-ink)!important;background:var(--unp-list-soft)!important;border-color:var(--unp-list-line)!important}
`;
  }
  apply(dark: boolean) {
    const root = document.getElementById('list_box');
    if (root !== this.root) {
      this.restore();
      this.root = root;
      this.previous = root?.getAttribute('data-unp-theme') ?? null;
    }
    if (!root) return;
    const value = dark ? 'dark' : 'light';
    if (root.dataset.unpTheme !== value) root.dataset.unpTheme = value;
    if (!this.sheet.isConnected) document.documentElement.append(this.sheet);
  }
  private restore() {
    if (this.root) {
      if (this.previous === null) this.root.removeAttribute('data-unp-theme');
      else this.root.setAttribute('data-unp-theme', this.previous);
    }
  }
  dispose() {
    this.restore();
    this.sheet.remove();
    this.root = null;
  }
}

export function nativeModeEntry(parent: HTMLElement, enable: () => Promise<void>) {
  const host = document.createElement('div');
  host.id = 'unp-native-enable';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>:host{display:block}section{padding:14px 12px;border-top:1px solid #aaa;font:13px/1.5 var(--unp-ui-font, "UNP UI Freesentation", system-ui);color:#30283e;background:#f7f4fb}button{font:inherit;color:#fff;background:#7050b4;border:0;border-radius:5px;padding:8px 12px;cursor:pointer}button:focus-visible{outline:2px solid #4b258e;outline-offset:3px}p{margin:0 0 10px}small{display:block;margin-top:8px;color:#6c2846}</style><section><p>Unofficial Novelpia Patch 사용</p><button type="button">확장 뷰어 켜기, 새로고침</button><small role="alert"></small></section>`;
  const button = shadow.querySelector('button')!;
  button.onclick = async (event) => {
    event.stopPropagation();
    button.disabled = true;
    button.textContent = '전환 중…';
    try {
      await enable();
    } catch (error) {
      button.disabled = false;
      button.textContent = '확장 뷰어 켜기, 새로고침';
      shadow.querySelector('small')!.textContent = String(error);
    }
  };
  parent.append(host);
  return () => host.remove();
}

export function reloadNotice(reload: () => Promise<void>) {
  const host = document.createElement('aside');
  host.id = 'unp-reload-notice';
  host.style.cssText =
    'position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:20000;max-width:calc(100vw - 32px)';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML =
    '<style>div{padding:12px 16px;border:1px solid #b8a1d5;border-radius:6px;background:#faf7ff;color:#30283e;font:14px/1.6 var(--unp-ui-font, "UNP UI Freesentation", system-ui)}button{margin-left:12px;padding:5px 10px;background:#7050b4;color:white;border:0;border-radius:4px;cursor:pointer;font:inherit}</style><div role="status">뷰어 사용 설정이 변경되었습니다.<button type="button">새로고침</button><span role="alert"></span></div>';
  shadow.querySelector('button')!.onclick = () => {
    void reload().catch((error) => {
      shadow.querySelector('[role="alert"]')!.textContent = String(error);
    });
  };
  document.body.append(host);
  return host;
}
