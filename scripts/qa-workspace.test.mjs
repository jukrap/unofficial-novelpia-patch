import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createWorkspace,
  workspaceInfo,
  removeWorkspace,
  processIsRunning,
  copyFailureEvidence,
} from './qa-workspace.mjs';

test('failure evidence keeps finalized traces and excludes Playwright scratch data', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'qa-contract-'));
  try {
    const source = path.join(root, 'results');
    const destination = path.join(root, 'archive');
    await mkdir(path.join(source, '.playwright-artifacts-0'), { recursive: true });
    await mkdir(path.join(source, 'failed-test'));
    await writeFile(path.join(source, '.playwright-artifacts-0', 'pending.network'), 'transient');
    await writeFile(path.join(source, 'failed-test', 'trace.zip'), 'final trace');
    await writeFile(path.join(source, 'summary.json'), '{"status":"failed"}');
    await copyFailureEvidence(source, destination);
    assert.deepEqual((await readdir(destination)).sort(), ['failed-test', 'summary.json']);
    assert.equal(
      await readFile(path.join(destination, 'failed-test', 'trace.zip'), 'utf8'),
      'final trace'
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

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
