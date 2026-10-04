/** page-flip 2.0.7 leaves a rendering loop and a resize listener after destroy().
 * Keep the pinned dependency's effect, but tie its work to its mounted element.
 * Fail closed if the upstream implementation changes instead of silently leaking.
 */
export function pageFlipLifecycle() {
  return {
    name: 'unp-page-flip-lifecycle',
    enforce: 'pre',
    transform(source, id) {
      if (!id.replaceAll('\\', '/').endsWith('/page-flip/dist/js/page-flip.module.js')) return null;
      const fixes = [
        [
          'const t=e=>{this.render(e),requestAnimationFrame(t)};requestAnimationFrame(t)',
          'const t=e=>{if(this.app.getUI().getDistElement().isConnected){this.render(e);requestAnimationFrame(t)}};requestAnimationFrame(t)',
        ],
        [
          'this.app.getSettings().useMouseEvents&&this.removeHandlers(),this.distElement.remove()',
          'this.removeHandlers(),this.distElement.remove()',
        ],
      ];
      for (const [before, after] of fixes) {
        if (source.split(before).length !== 2)
          throw new Error('page-flip lifecycle adapter requires the audited 2.0.7 ESM build.');
        source = source.replace(before, after);
      }
      return { code: source, map: null };
    },
  };
}
