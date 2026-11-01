import test from 'node:test';
import assert from 'node:assert/strict';
import {
  affectsRelease,
  canReuseBrowserEvidence,
  checkScope,
  inputFingerprint,
  packageReleaseInput,
  successfulFullRun,
} from './ci-contract.mjs';

test('docs skip browser; unknown/runtime/storage/build changes require full checks', () => {
  assert.equal(checkScope(['README.md', 'docs/RELEASE.md']).mode, 'docs');
  for (const file of [
    'src/app/start.ts',
    'src/entities/settings/model/store.ts',
    'public/fonts/a.woff2',
    'pnpm-lock.yaml',
    '.github/workflows/ci.yml',
    'new.config.ts',
  ]) {
    assert.equal(checkScope([file, 'README.md']).mode, 'full', file);
  }
  assert.equal(checkScope(['tests/unit/example.test.ts']).mode, 'unit');
  assert.deepEqual(checkScope(['src/pages/popup/ui/Popup.tsx']).suites, [
    'tests/e2e/management.spec.ts',
  ]);
});

test('fingerprint ignores docs only and detects paths, modes, toolchain and test changes', () => {
  const entries = [{ path: 'src/a.ts', type: 'blob', mode: '100644', sha: 'a' }];
  const key = inputFingerprint(entries);
  assert.equal(
    key,
    inputFingerprint([...entries, { path: 'README.md', mode: '100644', sha: 'b' }])
  );
  for (const change of [{ path: 'src/b.ts' }, { mode: '120000' }, { sha: 'b' }]) {
    assert.notEqual(key, inputFingerprint([{ ...entries[0], ...change }]));
  }
  assert.notEqual(
    key,
    inputFingerprint([...entries, { path: '.github/workflows/ci.yml', mode: '100644', sha: 'b' }])
  );
});

test('CI and store artwork changes do not publish an unchanged app version', () => {
  for (const file of [
    '.github/workflows/ci.yml',
    'tests/e2e/reader.spec.ts',
    'scripts/ci-plan.mjs',
    'scripts/release-check.mjs',
    'playwright.config.ts',
    'docs/RELEASE.md',
    'scripts/store-assets.mjs',
    'scripts/store-artwork.mjs',
    'scripts/store-promo.mjs',
  ])
    assert.equal(affectsRelease(file), false, file);
  for (const file of [
    'src/a.ts',
    'public/icon.png',
    'modules/esm.ts',
    'wxt.config.ts',
    'pnpm-lock.yaml',
    'scripts/store-unknown.mjs',
  ])
    assert.equal(affectsRelease(file), true, file);
  const pkg = { version: '1.0.0', scripts: { build: 'wxt build', 'test:ci': 'old' } };
  assert.deepEqual(
    packageReleaseInput(pkg),
    packageReleaseInput({ ...pkg, scripts: { ...pkg.scripts, 'test:ci': 'new' } })
  );
  assert.notDeepEqual(
    packageReleaseInput(pkg),
    packageReleaseInput({ ...pkg, scripts: { build: 'other' } })
  );
});

test('manual verification stays fresh while release retries can reuse matching evidence', () => {
  for (const operation of ['verify', undefined, 'store-status', 'unknown'])
    assert.equal(canReuseBrowserEvidence('workflow_dispatch', operation), false);
  assert.equal(canReuseBrowserEvidence('workflow_dispatch', 'release'), true);
  assert.equal(canReuseBrowserEvidence('push'), true);
  assert.equal(canReuseBrowserEvidence('pull_request'), true);
});

const run = {
  status: 'completed',
  conclusion: 'success',
  path: '.github/workflows/ci.yml',
  repository: { id: 1 },
  head_repository: { id: 1, full_name: 'owner/repo' },
  event: 'pull_request',
  updated_at: '2026-11-01T01:00:00Z',
};
const jobs = [
  { name: 'Static and package', conclusion: 'success' },
  { name: 'MV3 (Windows)', conclusion: 'success' },
  {
    name: 'MV3 suite',
    conclusion: 'success',
    steps: [{ name: 'Run full MV3 suite', conclusion: 'success' }],
  },
];
const options = {
  repository: 'owner/repo',
  repositoryId: 1,
  now: Date.parse('2026-11-01T02:00:00Z'),
};
test('reuse requires actual full Windows execution and same-repository successful current attempt', () => {
  assert(successfulFullRun(run, jobs, options));
  for (const patch of [
    { conclusion: 'failure' },
    { status: 'in_progress' },
    { path: '.github/workflows/other.yml' },
    { head_repository: { id: 2, full_name: 'owner/repo' } },
    { updated_at: '2026-10-29T01:00:00Z' },
  ])
    assert.equal(successfulFullRun({ ...run, ...patch }, jobs, options), false);
  assert.equal(successfulFullRun(run, jobs.slice(0, 2), options), false);
  assert.equal(
    successfulFullRun(
      run,
      [
        ...jobs.slice(0, 2),
        { ...jobs[2], steps: [{ name: 'Run full MV3 suite', conclusion: 'skipped' }] },
      ],
      options
    ),
    false
  );
});
