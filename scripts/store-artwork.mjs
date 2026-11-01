import { readFile } from 'node:fs/promises';
import path from 'node:path';

const encode = (bytes, type) => `data:${type};base64,${bytes.toString('base64')}`;
export async function artworkResources(root) {
  const faces = await Promise.all(
    [400, 600, 700].map(async (weight) => {
      const file = { 400: '4Regular', 600: '6SemiBold', 700: '7Bold' }[weight];
      const bytes = await readFile(path.join(root, `public/fonts/Freesentation-${file}.woff2`));
      return `@font-face{font-family:Artwork;src:url('${encode(bytes, 'font/woff2')}');font-weight:${weight}}`;
    })
  );
  return {
    css: faces.join('\n'),
    icon: encode(await readFile(path.join(root, 'public/icons/icon192.png')), 'image/png'),
  };
}

/** Marketing framing surrounds an unedited capture; it never imitates extension controls. */
export function posterHtml(
  resources,
  { title, description, label, image, dark = false, aside = false, inset = false }
) {
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><title>${label}</title><style>
  ${resources.css}
  *{box-sizing:border-box}body{margin:0;font-family:Artwork,sans-serif;background:${dark ? '#211d2b' : '#f4f1eb'};color:${dark ? '#f6f2ff' : '#25212d'}}
  main{width:1280px;height:800px;position:relative;overflow:hidden}
  .brand{position:absolute;left:64px;top:34px;display:flex;align-items:center;gap:10px;font-size:15px;font-weight:600;letter-spacing:.1px}.brand img{width:25px;height:25px}
  .label{position:absolute;right:64px;top:40px;font-size:13px;color:${dark ? '#c8bdd7' : '#756c7d'}}
  .copy{position:absolute;left:64px;top:${aside ? '170' : '88'}px;width:${aside ? '300' : '1152'}px}
  h1{font-size:${aside ? 45 : 48}px;font-weight:600;line-height:1.2;letter-spacing:-1.5px;margin:0;word-break:keep-all}
  p{font-size:21px;font-weight:400;line-height:1.65;margin:${aside ? '25px' : '12px'} 0 0;color:${dark ? '#c8bdd7' : '#6c6373'};word-break:keep-all}
  .screen{position:absolute;${aside ? 'left:416px;right:48px;top:88px;bottom:62px' : 'left:64px;right:64px;top:220px;bottom:55px'};display:flex;align-items:center;justify-content:center}
  .screen img{display:block;max-width:100%;max-height:100%;width:auto;height:auto;border-radius:10px;box-shadow:0 12px 36px #10091e15;border:1px solid ${dark ? '#51475f' : '#d9d2df'};${inset ? 'padding:22px;background:white' : ''}}
  .note{position:absolute;bottom:22px;left:64px;right:64px;display:flex;justify-content:space-between;font-size:12px;color:${dark ? '#bcb0ca' : '#776e7e'}}
  </style><main><div class="brand"><img src="${resources.icon}" alt="">Unofficial Novelpia Patch</div><div class="label">${label}</div><div class="copy"><h1>${title}</h1><p>${description}</p></div><div class="screen"><img alt="확장 실제 화면" src="${encode(image, 'image/png')}"></div><div class="note"><span>실제 확장 화면 · 직접 작성한 예시 본문</span><span>노벨피아 비공식 커뮤니티 확장</span></div></main></html>`;
}

export function promoHtml(resources) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Unofficial Novelpia Patch</title><style>
  ${resources.css}*{box-sizing:border-box}body{margin:0;font-family:Artwork,sans-serif;color:#fcf9ff}
  main{width:440px;height:280px;position:relative;overflow:hidden;background:linear-gradient(115deg,#28163f,#432664)}
  .pages{position:absolute;inset:0;width:100%;height:100%}
  .brand{position:relative;display:flex;align-items:center;justify-content:center;gap:22px;height:100%;padding:0 28px}
  .brand img{display:block;width:144px;height:144px;flex:none}
  h1{font-size:40px;line-height:1.05;letter-spacing:-.6px;font-weight:700;margin:0}
  h1 span{display:block}
  </style><main><svg class="pages" viewBox="0 0 440 280" aria-hidden="true"><path d="M294-30h210v340H412Z" fill="#68468a" opacity=".22"/><path d="M317-30 435 310M331-30 449 310" fill="none" stroke="#cfb7ec" stroke-width="1" opacity=".14"/></svg><div class="brand"><img alt="" src="${resources.icon}"><h1><span>Unofficial</span><span>Novelpia</span><span>Patch</span></h1></div></main></html>`;
}
