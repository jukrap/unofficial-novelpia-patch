import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { qaRoot, processIsRunning, workspaceInfo, removeWorkspace } from './qa-workspace.mjs';

if (process.argv.slice(2).some((arg) => arg !== '--apply'))
  throw new Error('Usage: pnpm qa:clean [--apply]');
for (const kind of ['profiles', 'failures']) {
  const parent = path.join(qaRoot, kind);
  const entries = await readdir(parent, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('run-')) continue;
    const directory = path.join(parent, entry.name);
    const owner = await workspaceInfo(directory);
    if (Date.now() - owner.createdAt < 7 * 86400000 || processIsRunning(owner.pid)) continue;
    console.log(
      `${process.argv.includes('--apply') ? 'Remove' : 'Would remove'}: ${path.relative(qaRoot, directory)}`
    );
    if (process.argv.includes('--apply')) await removeWorkspace(directory);
  }
}
console.log('Only inactive, marked QA runs older than 7 days are eligible. Use --apply to remove.');
