import { defineContentScript } from 'wxt/utils/define-content-script';
import { viewerMatches } from '@/shared/config/matches';
import { startNativeBridge } from '@/app/runtime/native';
export default defineContentScript({
  matches: viewerMatches,
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    startNativeBridge();
  },
});
