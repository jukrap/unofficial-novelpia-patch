import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createWorkspace,
  workspaceInfo,
  removeWorkspace,
  processIsRunning,
} from './qa-workspace.mjs';

test('QA cleanup confines deletion to marked project run directories', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'qa-contract-'));
  try {
    const run = await createWorkspace('profiles', root);
    assert.equal((await workspaceInfo(run, root)).pid, process.pid);
    assert(processIsRunning(process.pid));
    await assert.rejects(removeWorkspace(root, root), /Outside/);
    const unknown = path.join(root, 'profiles', 'run-unknown');
    await mkdir(unknown);
    await assert.rejects(removeWorkspace(unknown, root));
    await removeWorkspace(run, root);
    await assert.rejects(workspaceInfo(run, root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('QA cleanup refuses a junction to files outside the marked run', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'qa-contract-'));
  try {
    const run = await createWorkspace('profiles', root);
    const outside = path.join(root, 'keep');
    await mkdir(outside);
    const link = path.join(run, 'link');
    await symlink(outside, link, 'junction');
    await assert.rejects(removeWorkspace(run, root), /symlinks/);
    await rm(link);
    await removeWorkspace(run, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
