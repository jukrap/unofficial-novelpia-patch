import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ViewerModeSwitch } from './viewer-mode-switch';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it('keeps the saved state while switching and after a storage failure', async () => {
  let reject!: (cause: Error) => void;
  const change = vi.fn(
    () =>
      new Promise<void>((_resolve, fail) => {
        reject = fail;
      })
  );
  await act(() => {
    root.render(<ViewerModeSwitch enabled onChangeAsync={change} context="viewer" />);
  });
  const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]')!;
  await act(() => toggle.click());
  expect(change).toHaveBeenCalledWith(false);
  expect(toggle.disabled).toBe(true);
  expect(toggle.getAttribute('aria-checked')).toBe('true');
  await act(() => toggle.click());
  expect(change).toHaveBeenCalledOnce();
  await act(() => reject(new Error('설정을 저장하지 못했습니다.')));
  expect(toggle.disabled).toBe(false);
  expect(toggle.getAttribute('aria-checked')).toBe('true');
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    '설정을 저장하지 못했습니다.'
  );
});

it('announces refresh only for a connected reader and links the explanation to the switch', async () => {
  const change = vi.fn(async () => {});
  await act(() => {
    root.render(
      <ViewerModeSwitch enabled onChangeAsync={change} context="popup" connected={false} />
    );
  });
  const toggle = container.querySelector('[role="switch"]')!;
  const explanation = document.getElementById(toggle.getAttribute('aria-describedby')!);
  expect(explanation?.textContent).toBe('열린 뷰어에는 새로고침 후 적용됩니다.');
  await act(() => {
    root.render(<ViewerModeSwitch enabled onChangeAsync={change} context="popup" connected />);
  });
  expect(explanation?.textContent).toBe('변경하면 현재 회차를 새로고침합니다.');
});
