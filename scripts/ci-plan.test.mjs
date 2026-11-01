import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'yaml';

test('workflow keeps protected gates, removes develop push and isolates publication', async () => {
  const config = parse(
    await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
  );
  assert.deepEqual(config.on.push.branches, ['main']);
  assert.deepEqual(config.on.pull_request.branches, ['main', 'develop']);
  assert.equal(config.jobs.static.name, 'Static and package');
  assert.equal(config.jobs.mv3.name, 'MV3 (Windows)');
  assert.match(config.jobs.mv3.if, /always\(\)/);
  assert(config.jobs.mv3.needs.includes('plan'));
  assert.match(config.jobs.release.if, /needs.plan.outputs.release == 'true'/);
  assert.equal(config.jobs['store-submit'].concurrency['cancel-in-progress'], false);
  assert.equal(config.jobs.browser['runs-on'], 'windows-2022');
  assert.equal(config.jobs.plan.permissions['actions'], 'read');
});

test('real planner falls back on API failure, stale/different input, truncated tree or skipped full suite', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ci-plan-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  try {
    git('init', '--quiet');
    git('config', 'user.name', 'CI fixture');
    git('config', 'user.email', 'ci@example.invalid');
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '1.0.0' }));
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'src/reader.ts'), 'old');
    git('add', '.');
    git('commit', '--quiet', '-m', 'test: base');
    const base = git('rev-parse', 'HEAD');
    await writeFile(path.join(root, 'src/reader.ts'), 'new');
    git('add', '.');
    git('commit', '--quiet', '-m', 'test: runtime');
    const sha = git('rev-parse', 'HEAD');
    const tree = git('ls-tree', '-rz', 'HEAD')
      .split('\0')
      .filter(Boolean)
      .map((line) => {
        const [meta, path] = line.split('\t');
        const [mode, type, sha] = meta.split(' ');
        return { path, mode, type, sha };
      });
    const eventPath = path.join(root, 'event.json');
    await writeFile(
      eventPath,
      JSON.stringify({
        repository: { id: 1 },
        pull_request: {
          head: { sha, repo: { id: 1 } },
          base: { sha: base, ref: 'main' },
        },
      })
    );
    const run = {
      id: 10,
      run_attempt: 1,
      status: 'completed',
      conclusion: 'success',
      path: '.github/workflows/ci.yml',
      repository: { id: 1 },
      head_repository: { id: 1, full_name: 'owner/repo' },
      event: 'pull_request',
      updated_at: new Date().toISOString(),
      head_sha: sha,
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
    const loader = path.join(root, 'fetch.mjs');
    await writeFile(
      loader,
      `import {readFile} from 'node:fs/promises';
      const fixture=JSON.parse(await readFile(new URL('./responses.json', import.meta.url)));
      globalThis.fetch=async(url)=>{
        if(fixture.failure) return {ok:false,status:403};
        const body=url.includes('/trees/')?fixture.tree:url.includes('/jobs?')?{jobs:fixture.jobs}:{workflow_runs:[fixture.run]};
        return {ok:true,json:async()=>body};
      };`
    );
    for (const scenario of [
      'valid',
      'failure',
      'different',
      'truncated',
      'skipped',
      'fork',
      'expired',
    ]) {
      const fixture = structuredClone({ run, tree: { tree, truncated: false }, jobs });
      if (scenario === 'failure') fixture.failure = true;
      if (scenario === 'different') fixture.tree.tree[0].sha = 'different';
      if (scenario === 'truncated') fixture.tree.truncated = true;
      if (scenario === 'skipped') fixture.jobs[2].steps[0].conclusion = 'skipped';
      if (scenario === 'fork') fixture.run.head_repository.id = 2;
      if (scenario === 'expired') fixture.run.updated_at = '2000-01-01T00:00:00Z';
      await writeFile(path.join(root, 'responses.json'), JSON.stringify(fixture));
      const output = path.join(root, `${scenario}.txt`);
      execFileSync(
        process.execPath,
        [
          '--import',
          pathToFileURL(loader).href,
          fileURLToPath(new URL('./ci-plan.mjs', import.meta.url)),
        ],
        {
          cwd: root,
          encoding: 'utf8',
          env: {
            ...process.env,
            GITHUB_EVENT_PATH: eventPath,
            GITHUB_EVENT_NAME: 'pull_request',
            GITHUB_REF: 'refs/pull/1/merge',
            GITHUB_REPOSITORY: 'owner/repo',
            GITHUB_SHA: sha,
            GITHUB_RUN_ID: '11',
            GITHUB_OUTPUT: output,
            GITHUB_STEP_SUMMARY: path.join(root, 'summary.md'),
          },
        }
      );
      const result = await readFile(output, 'utf8');
      assert.match(
        result,
        new RegExp(`browser=${scenario === 'valid' ? 'false' : 'true'}`),
        scenario
      );
      assert.match(result, /release=true/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
