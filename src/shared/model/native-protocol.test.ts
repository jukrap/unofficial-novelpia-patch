import { it, expect } from 'vitest';
import { isNativeCommand, isNativeState } from './native-protocol';
it('restricts the MAIN bridge to a bounded native option protocol', () => {
  for (const command of [
    { type: 'eval', code: 'alert(1)' },
    { type: 'option', option: 'purchase', value: true },
    { type: 'sync', page: 1, total: NaN, stride: 100 },
    { type: 'option', option: 'mode', value: true },
  ])
    expect(isNativeCommand(command)).toBe(false);
  expect(isNativeCommand({ type: 'option', option: 'illustrations', value: true })).toBe(true);
  expect(isNativeCommand({ type: 'sync', page: 3, total: 20, stride: 1100 })).toBe(true);
  expect(isNativeState({ mode: 'page' })).toBe(false);
});
