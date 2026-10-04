import { version } from '../../../package.json';

// Rendered UI can outlive its extension context during reload teardown.
// A build-time value needs no runtime API and stays aligned with the manifest.
export const EXTENSION_VERSION = version;
export const PROJECT_URL = 'https://github.com/jukrap/unofficial-novelpia-patch';
export const ISSUES_URL = `${PROJECT_URL}/issues`;
