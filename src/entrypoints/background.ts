import { defineBackground } from 'wxt/utils/define-background';
import { installBackgroundAssetService } from '@/shared/platform/background-assets-server';
import { installReadingStatsService } from '@/entities/reading-stats';
import { installUserFontService } from '@/entities/local-fonts';
import { installViewerModeService } from '@/app/runtime/viewer-mode-service';
import { installReadingPositionService } from '@/app/runtime/reading-position-service';
export default defineBackground(() => {
  installBackgroundAssetService();
  installUserFontService();
  installReadingStatsService();
  installViewerModeService();
  installReadingPositionService();
});
