import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { parse } from 'yaml';

const { jobs } = parse(
  await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
);

// These conditions use only boolean/equality operators shared by JS and Actions.
// Model Actions' implicit success() over ancestors, including a skipped browser job.
function runs(
  job,
  {
    needs,
    event = 'push',
    ref = 'refs/heads/main',
    operation = '',
    enabled = 'true',
    cancelled = false,
  }
) {
  const condition = jobs[job].if;
  const hasStatusCheck = /\b(?:always|cancelled|failure|success)\s*\(/.test(condition);
  return Boolean(
    runInNewContext(
      hasStatusCheck ? condition : `success() && (${condition})`,
      {
        needs,
        github: { ref, event_name: event },
        inputs: { operation },
        vars: { CWS_SUBMIT_ENABLED: enabled },
        cancelled: () => cancelled,
        success: () => Object.values(needs).every((job) => job.result === 'success'),
      },
      { timeout: 100 }
    )
  );
}

const passing = () => ({
  plan: { result: 'success', outputs: { release: 'true' } },
  static: { result: 'success' },
  browser: { result: 'skipped' },
  mv3: { result: 'success' },
  release: { result: 'success' },
});

test('reused browser evidence does not suppress release or store submission', () => {
  for (const job of ['release', 'store-submit']) {
    assert.equal(runs(job, { needs: passing() }), true);
    assert.equal(runs(job, { needs: passing(), cancelled: true }), false);
    assert.equal(runs(job, { needs: passing(), ref: 'refs/heads/develop' }), false);
  }
  assert.equal(
    runs('release', { needs: passing(), event: 'workflow_dispatch', operation: 'release' }),
    true
  );
  assert.equal(
    runs('release', { needs: passing(), event: 'workflow_dispatch', operation: 'verify' }),
    false
  );
  assert.equal(runs('release', { needs: passing(), event: 'pull_request' }), false);
  assert.equal(runs('store-submit', { needs: passing(), enabled: 'false' }), false);
});

test('failed or missing required gates cannot publish, even with skipped ancestors', () => {
  for (const prerequisite of ['plan', 'static', 'mv3']) {
    for (const result of ['failure', 'cancelled', 'skipped']) {
      const needs = passing();
      needs[prerequisite].result = result;
      assert.equal(runs('release', { needs }), false, `${prerequisite}: ${result}`);
    }
  }
  for (const result of ['failure', 'cancelled', 'skipped']) {
    const needs = passing();
    needs.release.result = result;
    assert.equal(runs('store-submit', { needs }), false);
  }
  const docs = passing();
  docs.plan.outputs.release = 'false';
  assert.equal(runs('release', { needs: docs }), false);
});
