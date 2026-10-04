export class StyleLedger {
  private styles = new Map<
    HTMLElement,
    Map<string, { value: string; priority: string; applied: string }>
  >();
  set(el: HTMLElement, key: string, value: string, priority = 'important') {
    let map = this.styles.get(el);
    if (!map) {
      map = new Map();
      this.styles.set(el, map);
    }
    let old = map.get(key);
    if (!old || el.style.getPropertyValue(key) !== old.applied) {
      old = {
        value: el.style.getPropertyValue(key),
        priority: el.style.getPropertyPriority(key),
        applied: value,
      };
      map.set(key, old);
    }
    el.style.setProperty(key, value, priority);
    old.applied = el.style.getPropertyValue(key);
  }
  restore() {
    for (const [el, values] of this.styles)
      for (const [key, old] of values) {
        if (el.style.getPropertyValue(key) === old.applied) {
          if (old.value) el.style.setProperty(key, old.value, old.priority);
          else el.style.removeProperty(key);
        }
      }
    this.styles.clear();
  }
}
