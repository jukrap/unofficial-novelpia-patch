import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useStore } from 'zustand';
import { expect, it, vi } from 'vitest';
import { SettingsStore } from './store';
import { memoryStorage } from '../../../../tests/helpers/storage';

it('theme-only consumers ignore typography and save status, while storage listeners still see updates', async () => {
  const settings = new SettingsStore(memoryStorage().port);
  await settings.initialize();
  const container = document.createElement('div');
  const root = createRoot(container);
  const renders = vi.fn();
  const observe = vi.fn();
  settings.subscribe(observe);
  function Theme() {
    const dark = useStore(settings.state, (state) => state.settings.darkMode);
    renders(dark);
    return <span>{String(dark)}</span>;
  }
  try {
    await act(async () => root.render(<Theme />));
    const before = renders.mock.calls.length;
    await act(async () => {
      settings.update({ fontSize: 24 });
      await settings.flush();
    });
    expect(observe).toHaveBeenCalled();
    expect(renders).toHaveBeenCalledTimes(before);
    const dark = !settings.getSnapshot().settings.darkMode;
    await act(async () => settings.update({ darkMode: dark }));
    expect(container.textContent).toBe(String(dark));
    await settings.flush();
    settings.dispose();
    const notifications = observe.mock.calls.length;
    await settings.initialize();
    expect(observe).toHaveBeenCalledTimes(notifications);
  } finally {
    await act(async () => root.unmount());
    settings.dispose();
  }
});
