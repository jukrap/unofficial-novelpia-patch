import { createRoot } from 'react-dom/client';
import { PopupPage } from '@/pages/popup';
import { installUiFonts, loadUiFonts } from '@/shared/platform/ui-fonts';

const releaseUiFonts = installUiFonts();
const fontsReady = loadUiFonts();
window.addEventListener('pagehide', (event) => {
  if (!event.persisted) releaseUiFonts();
});
createRoot(document.getElementById('app')!).render(<PopupPage fontsReady={fontsReady} />);
