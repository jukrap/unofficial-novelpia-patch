// @ts-expect-error Shared Node-only maintenance module.
import { createWorkspace, removeWorkspace } from '../../scripts/qa-workspace.mjs';

export default async function setup() {
  const directory: string = await createWorkspace('profiles');
  const previous = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR };
  // Child workers and Chromium inherit this, without changing Windows user settings.
  Object.assign(process.env, { TEMP: directory, TMP: directory, TMPDIR: directory });
  return async () => {
    try {
      await removeWorkspace(directory);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  };
}
