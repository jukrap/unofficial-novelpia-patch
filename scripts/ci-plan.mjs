import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFile, readFile } from 'node:fs/promises';
import {
  affectsRelease,
  canReuseBrowserEvidence,
  checkScope,
  inputFingerprint,
  packageReleaseInput,
  successfulFullRun,
} from './ci-contract.mjs';

const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
const head = git('rev-parse', 'HEAD').trim();
const expected = event.pull_request?.head.sha ?? process.env.GITHUB_SHA;
assert.equal(head, expected, 'CI must check out the reported head commit.');
const repository = process.env.GITHUB_REPOSITORY;
const base =
  event.pull_request?.base.sha ??
  (process.env.GITHUB_EVENT_NAME === 'push' ? event.before : undefined);
if (base) assert.match(base, /^[a-f0-9]{40}$/);
const files =
  base && !/^0+$/.test(base)
    ? git('diff', '--name-only', '--no-renames', '-z', base, head).split('\0').filter(Boolean)
    : ['unknown'];
const scope = checkScope(files);
const manual = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch';
if (manual) scope.mode = 'full';
const main =
  event.pull_request?.base.ref === 'main' || process.env.GITHUB_REF === 'refs/heads/main';
let releaseChange = files.some((file) => file !== 'package.json' && affectsRelease(file));
if (files.includes('package.json')) {
  const current = packageReleaseInput(JSON.parse(git('show', `${head}:package.json`)));
  const previous =
    base && !/^0+$/.test(base)
      ? packageReleaseInput(JSON.parse(git('show', `${base}:package.json`)))
      : null;
  releaseChange ||= JSON.stringify(current) !== JSON.stringify(previous);
}
if (main && releaseChange) scope.mode = 'full';
const entries = git('ls-tree', '-rz', head)
  .split('\0')
  .filter(Boolean)
  .map((line) => {
    const [metadata, path] = line.split('\t');
    const [mode, type, sha] = metadata.split(' ');
    return { path, mode, type, sha };
  });
const fingerprint = inputFingerprint(entries);
const api = async (path) => {
  const response = await fetch(`https://api.github.com/repos/${repository}/${path}`, {
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`GitHub evidence lookup: HTTP ${response.status}`);
  return response.json();
};
let reused = '';
// Manual verify is always fresh; release retries may reuse the same proven inputs.
// Forks neither supply nor consume evidence.
if (
  canReuseBrowserEvidence(process.env.GITHUB_EVENT_NAME, process.env.CI_OPERATION) &&
  ['full', 'focused'].includes(scope.mode) &&
  (!event.pull_request || event.pull_request.head.repo?.id === event.repository.id)
) {
  try {
    const result = await api('actions/workflows/ci.yml/runs?status=success&per_page=30');
    for (const run of result.workflow_runs) {
      if (
        String(run.id) === process.env.GITHUB_RUN_ID ||
        Date.now() - Date.parse(run.updated_at) > 86400000 ||
        run.head_repository?.id !== event.repository.id
      )
        continue;
      const tree = await api(`git/trees/${run.head_sha}?recursive=1`);
      if (tree.truncated || inputFingerprint(tree.tree) !== fingerprint) continue;
      const { jobs } = await api(
        `actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`
      );
      if (successfulFullRun(run, jobs, { repository, repositoryId: event.repository.id })) {
        reused = `https://github.com/${repository}/actions/runs/${run.id}`;
        break;
      }
    }
  } catch (error) {
    // Missing/expired/inaccessible evidence never counts as passing verification.
    console.log(`${error.message}; running the required browser tests.`);
  }
}
const output = {
  mode: scope.mode,
  suites: JSON.stringify(scope.suites),
  reused,
  browser: String(['full', 'focused'].includes(scope.mode) && !reused),
  release: String(main && (releaseChange || process.env.CI_OPERATION === 'release')),
  release_base: main && releaseChange && base ? base : '',
};
await appendFile(
  process.env.GITHUB_OUTPUT,
  Object.entries(output)
    .map(([key, value]) => `${key}=${value}\n`)
    .join('')
);
await appendFile(
  process.env.GITHUB_STEP_SUMMARY,
  `## Verification plan\n\n- Scope: **${scope.mode}**\n- Changed files: ${files.length}\n- Input fingerprint: \`${fingerprint}\`\n- Browser: ${reused ? `reuse [successful full run](${reused})` : output.browser === 'true' ? 'fresh run' : 'not required for this change'}\n- Release: ${output.release}\n`
);
