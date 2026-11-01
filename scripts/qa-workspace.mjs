import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  lstat,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

export const qaRoot = path.resolve('.output/qa');
export async function createWorkspace(kind, root = qaRoot) {
  assert(['profiles', 'failures'].includes(kind));
  const parent = path.join(root, kind);
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, 'run-'));
  await writeFile(
    path.join(directory, '.qa-owner.json'),
    JSON.stringify({
      version: 1,
      kind,
      pid: process.pid,
      createdAt: Date.now(),
    })
  );
  return directory;
}

export async function workspaceInfo(directory, root = qaRoot) {
  const resolved = path.resolve(directory);
  const parent = path.dirname(resolved);
  assert(
    ['profiles', 'failures'].some((kind) => parent === path.join(path.resolve(root), kind)),
    'Outside QA workspace'
  );
  assert(path.basename(resolved).startsWith('run-'), 'Not a QA run');
  assert.equal(await realpath(root), path.resolve(root), 'QA root cannot be a symlink');
  assert.equal(await realpath(resolved), resolved, 'QA workspace cannot be a symlink');
  const owner = JSON.parse(await readFile(path.join(resolved, '.qa-owner.json'), 'utf8'));
  assert.equal(owner.version, 1);
  assert.equal(owner.kind, path.basename(parent));
  assert(Number.isSafeInteger(owner.pid) && owner.pid > 0 && Number.isFinite(owner.createdAt));
  return owner;
}

export async function removeWorkspace(directory, root = qaRoot) {
  await workspaceInfo(directory, root);
  // Do not follow unexpected junctions/symlinks while deleting browser data.
  async function inspect(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      assert(!(await lstat(file)).isSymbolicLink(), 'QA cleanup refuses symlinks');
      if (entry.isDirectory()) await inspect(file);
    }
  }
  await inspect(directory);
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

export function processIsRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}
