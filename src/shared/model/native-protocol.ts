export const NATIVE_CHANNEL = 'unp.native.v1';
export type NativeOption =
  | 'mode'
  | 'dark'
  | 'illustrations'
  | 'animation'
  | 'autoNext'
  | 'navigation';
export interface NativeState {
  mode: 'scroll' | 'page';
  dark: boolean;
  illustrations: boolean;
  animation: boolean;
  autoNext: boolean;
  navigation: boolean;
  page: number;
  total: number;
  available: boolean;
}
export function isNativeState(value: unknown): value is NativeState {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    ['scroll', 'page'].includes(String(v.mode)) &&
    ['dark', 'illustrations', 'animation', 'autoNext', 'navigation', 'available'].every(
      (k) => typeof v[k] === 'boolean'
    ) &&
    ['page', 'total'].every(
      (k) =>
        typeof v[k] === 'number' &&
        Number.isInteger(v[k]) &&
        (v[k] as number) > 0 &&
        (v[k] as number) < 1e8
    )
  );
}
export type NativeCommand =
  | { type: 'read' }
  | { type: 'option'; option: NativeOption; value: boolean | 'scroll' | 'page' }
  | { type: 'sync'; page: number; total: number; stride: number }
  | { type: 'release' | 'dispose' };
export interface NativeReply {
  channel: typeof NATIVE_CHANNEL;
  direction: 'reply';
  id: string;
  state?: NativeState;
  error?: string;
}
export function isNativeCommand(value: unknown): value is NativeCommand {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.type === 'read' || v.type === 'release' || v.type === 'dispose') return true;
  if (v.type === 'sync')
    return (
      ['page', 'total', 'stride'].every(
        (k) =>
          typeof v[k] === 'number' &&
          Number.isFinite(v[k]) &&
          (v[k] as number) > 0 &&
          (v[k] as number) < 1e8
      ) &&
      Number.isInteger(v.page) &&
      Number.isInteger(v.total)
    );
  if (v.type === 'option')
    return (
      (v.option === 'mode' && ['page', 'scroll'].includes(String(v.value))) ||
      (['dark', 'illustrations', 'animation', 'autoNext', 'navigation'].includes(
        String(v.option)
      ) &&
        typeof v.value === 'boolean')
    );
  return false;
}
