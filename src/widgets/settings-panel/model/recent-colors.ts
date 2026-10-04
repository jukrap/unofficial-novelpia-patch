import { useSyncExternalStore } from 'react';
import { ColorHistory } from '@/entities/color-history';
import { chromeStorage } from '@/shared/platform/storage';

let history: ColorHistory | undefined;
export function useRecentColors() {
  const store = (history ??= new ColorHistory(chromeStorage()));
  const colors = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { colors, remember: (color: string) => void store.remember(color) };
}
