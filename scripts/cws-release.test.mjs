import assert from 'node:assert/strict';
import test from 'node:test';
import { runStore, submissionDecision } from './cws-release.mjs';

const env = {
  CWS_SUBMIT_ENABLED: 'true',
  CWS_PUBLISHER_ID: 'publisher',
  CWS_EXTENSION_ID: 'a'.repeat(32),
  CWS_ACCESS_TOKEN: 'test-only',
};
const revision = (state, version) => ({ state, distributionChannels: [{ crxVersion: version }] });
const loadRelease = async () => ({
  metadata: { version: '0.2.0' },
  bytes: Buffer.from('test-package'),
});
const response = (value, status = 200) => ({ ok: status < 400, status, json: async () => value });

test('disabled submission cannot read credentials, read files or issue any request', async () => {
  for (const value of [undefined, 'false', 'TRUE', '1']) {
    const deny = async () => {
      throw new Error('must not be invoked');
    };
    assert.deepEqual(
      await runStore({
        operation: 'submit',
        env: { CWS_SUBMIT_ENABLED: value },
        fetchImpl: deny,
        loadRelease: deny,
      }),
      { result: 'disabled' }
    );
  }
});

test('status operation is GET-only even when submission is enabled', async () => {
  const calls = [];
  const result = await runStore({
    operation: 'status',
    env,
    loadRelease: async () => {
      throw new Error('no file reads');
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response({});
    },
  });
  assert.equal(result.result, 'status');
  assert.equal(calls.length, 1);
  assert(calls[0].url.endsWith(':fetchStatus'));
  assert.equal(calls[0].options.method, undefined);
});

test('another pending review defers submission without upload, publish or cancellation', async () => {
  const calls = [];
  const result = await runStore({
    operation: 'submit',
    env,
    loadRelease,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response({ submittedItemRevisionStatus: revision('PENDING_REVIEW', '0.1.0') });
    },
  });
  assert.equal(result.result, 'deferred-review');
  assert.deepEqual(result.submitted.versions, ['0.1.0']);
  assert.equal(calls.length, 1);
  assert(calls[0].url.endsWith(':fetchStatus'));
  assert.equal(calls[0].options.method, undefined);
});

test('staged approval, unknown state, warnings and version rollback never upload', async () => {
  const blocked = [
    { submittedItemRevisionStatus: revision('STAGED', '0.1.0') },
    { submittedItemRevisionStatus: revision('FUTURE_STATE', '0.1.0') },
    { publishedItemRevisionStatus: revision('PUBLISHED', '0.3.0') },
    { warned: true },
    { takenDown: true },
    { lastAsyncUploadState: 'IN_PROGRESS' },
  ];
  for (const initial of blocked) {
    let calls = 0;
    await assert.rejects(
      runStore({
        operation: 'submit',
        env,
        loadRelease,
        fetchImpl: async (_url, options) => {
          calls++;
          assert.equal(options.method, undefined);
          return response(initial);
        },
      })
    );
    assert.equal(calls, 1);
  }
  assert.equal(
    submissionDecision(
      { submittedItemRevisionStatus: revision('PENDING_REVIEW', '0.2.0') },
      '0.2.0'
    ),
    'already-submitted'
  );
  assert.equal(
    submissionDecision({ publishedItemRevisionStatus: revision('PUBLISHED', '0.2.0') }, '0.2.0'),
    'already-published'
  );
});

test('successful asynchronous upload is checked before explicit default review submission', async () => {
  const calls = [];
  const responses = [
    {},
    { uploadState: 'IN_PROGRESS' },
    { lastAsyncUploadState: 'SUCCEEDED' },
    {},
    { state: 'PENDING_REVIEW' },
  ];
  const result = await runStore({
    operation: 'submit',
    env,
    loadRelease,
    wait: async () => {},
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(responses.shift());
    },
  });
  assert.equal(result.result, 'submitted');
  assert.equal(calls.filter((call) => call.options.method === 'POST').length, 2);
  assert(calls[1].url.includes('/upload/v2/'));
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), {
    publishType: 'DEFAULT_PUBLISH',
    skipReview: false,
    blockOnWarnings: true,
  });
  assert(calls.every((call) => !call.url.includes('cancel')));
});

test('HTTP failures and ambiguous uploads are never retried or followed by publish', async () => {
  for (const fail of ['http', 'timeout', 'wrong-version']) {
    const calls = [];
    await assert.rejects(
      runStore({
        operation: 'submit',
        env,
        loadRelease,
        fetchImpl: async (url) => {
          calls.push(url);
          if (calls.length === 1) return response({});
          if (fail === 'timeout') throw new Error('network failure');
          return fail === 'http'
            ? response({}, 503)
            : response({ uploadState: 'SUCCEEDED', crxVersion: '0.1.0' });
        },
      })
    );
    assert.equal(calls.length, 2);
    assert(!calls.some((url) => url.endsWith(':publish')));
  }
});

test('new manual submission during upload is preserved without a second publish', async () => {
  const replies = [
    {},
    { uploadState: 'SUCCEEDED', crxVersion: '0.2.0' },
    { submittedItemRevisionStatus: revision('PENDING_REVIEW', '0.2.0') },
  ];
  const calls = [];
  const result = await runStore({
    operation: 'submit',
    env,
    loadRelease,
    fetchImpl: async (url) => {
      calls.push(url);
      return response(replies.shift());
    },
  });
  assert.equal(result.result, 'already-submitted');
  assert.equal(calls.length, 3);
});

test('a stalled asynchronous upload stops after bounded polling without publishing', async () => {
  let calls = 0;
  let writes = 0;
  await assert.rejects(
    runStore({
      operation: 'submit',
      env,
      loadRelease,
      wait: async () => {},
      fetchImpl: async (_url, options) => {
        calls++;
        if (calls === 1) return response({});
        if (options.method === 'POST') {
          writes++;
          return response({ uploadState: 'IN_PROGRESS' });
        }
        return response({ lastAsyncUploadState: 'IN_PROGRESS' });
      },
    }),
    /아직 끝나지/
  );
  assert.equal(writes, 1);
  assert.equal(calls, 32);
});
