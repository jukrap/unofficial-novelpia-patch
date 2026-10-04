import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { publishGithub } from './release-github.mjs';
import { sha256 } from './release-package.mjs';

const env = {
  GITHUB_REF: 'refs/heads/main',
  GITHUB_REPOSITORY: 'owner/project',
  GITHUB_SHA: 'a'.repeat(40),
  GITHUB_TOKEN: 'test-only',
};
const bytes = Buffer.from('test-zip');
const metadata = { version: '0.2.0', filename: 'package.zip' };
const text = Buffer.from('test-notes');
const loadRelease = async () => ({ metadata, bytes });
const loadFile = async () => text;
const response = (value, status = 200) => ({ ok: status < 400, status, json: async () => value });
const assets = () => [
  { name: 'package.zip', size: bytes.length, digest: `sha256:${sha256(bytes)}` },
  { name: 'SHA256SUMS', size: text.length, digest: `sha256:${sha256(text)}` },
  { name: 'release.json', size: text.length, digest: `sha256:${sha256(text)}` },
];

test('CLI entry reaches the branch guard without requiring a function argument', () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./release-github.mjs', import.meta.url))],
    {
      env: { ...process.env, GITHUB_REF: 'refs/heads/develop', GITHUB_TOKEN: '' },
      encoding: 'utf8',
    }
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /main에서만/);
  assert.doesNotMatch(result.stderr, /TypeError|Cannot read/);
});

test('existing matching release is a read-only successful retry', async () => {
  const calls = [];
  const result = await publishGithub({
    env,
    loadRelease,
    loadFile,
    fetchImpl: async (url, options) => {
      calls.push(options.method);
      return response(
        url.includes('/git/ref/')
          ? { object: { type: 'commit', sha: env.GITHUB_SHA } }
          : {
              id: 1,
              draft: false,
              html_url: 'https://github.com/owner/project/releases/tag/v0.2.0',
              assets: assets(),
            }
      );
    },
  });
  assert.equal(result.tag, 'v0.2.0');
  assert.deepEqual(calls, ['GET', 'GET']);
});

test('a tag on another commit or a changed asset cannot be overwritten', async () => {
  for (const mismatch of ['tag', 'asset']) {
    const calls = [];
    await assert.rejects(
      publishGithub({
        env,
        loadRelease,
        loadFile,
        fetchImpl: async (url, options) => {
          calls.push(options.method);
          if (url.includes('/git/ref/'))
            return response({
              object: { type: 'commit', sha: mismatch === 'tag' ? 'b'.repeat(40) : env.GITHUB_SHA },
            });
          const changed = assets();
          changed[0].digest = 'sha256:changed';
          return response({ id: 1, draft: false, assets: changed });
        },
      })
    );
    assert(calls.every((method) => method === 'GET'));
  }
});

test('a partially uploaded draft resumes without replacing completed assets', async () => {
  const calls = [];
  const result = await publishGithub({
    env,
    loadRelease,
    loadFile,
    fetchImpl: async (url, options) => {
      calls.push({ url, method: options.method });
      if (url.includes('/git/ref/'))
        return response({ object: { type: 'commit', sha: env.GITHUB_SHA } });
      if (url.includes('/releases/tags/')) return response({}, 404);
      if (url.includes('/releases?'))
        return response([
          {
            id: 1,
            tag_name: 'v0.2.0',
            draft: true,
            assets: assets().slice(0, 1),
            upload_url:
              'https://uploads.github.com/repos/owner/project/releases/1/assets{?name,label}',
          },
        ]);
      if (url.startsWith('https://uploads.github.com'))
        return response({ digest: `sha256:${sha256(options.body)}` });
      assert.equal(options.method, 'PATCH');
      return response({
        id: 1,
        draft: false,
        html_url: 'https://github.com/owner/project/releases/tag/v0.2.0',
      });
    },
  });
  assert.equal(result.tag, 'v0.2.0');
  assert.equal(calls.filter((call) => call.method === 'POST').length, 2);
  assert(!calls.some((call) => call.method === 'DELETE'));
});

test('a starter upload reports manual draft recovery without deleting or replacing assets', async () => {
  const methods = [];
  await assert.rejects(
    publishGithub({
      env,
      loadRelease,
      loadFile,
      fetchImpl: async (url, options) => {
        methods.push(options.method);
        if (url.includes('/git/ref/')) {
          return response({ object: { type: 'commit', sha: env.GITHUB_SHA } });
        }
        return response({
          id: 1,
          draft: true,
          assets: [{ name: 'package.zip', state: 'starter', size: 0 }],
        });
      },
    }),
    /starter.*초안.*확인·제거/
  );
  assert.deepEqual(methods, ['GET', 'GET']);
});

test('draft lookup follows list pagination before retrying a completed draft', async () => {
  const methods = [];
  const urls = [];
  await publishGithub({
    env,
    loadRelease,
    loadFile,
    fetchImpl: async (url, options) => {
      methods.push(options.method);
      urls.push(url);
      if (url.includes('/git/ref/')) {
        return response({ object: { type: 'commit', sha: env.GITHUB_SHA } });
      }
      if (url.includes('/releases/tags/')) return response({}, 404);
      if (new URL(url).searchParams.get('page') === '1') {
        return response(Array.from({ length: 100 }, (_, i) => ({ tag_name: `v0.1.${i}` })));
      }
      if (new URL(url).searchParams.get('page') === '2') {
        return response([{ id: 1, tag_name: 'v0.2.0', draft: true, assets: assets() }]);
      }
      assert.equal(options.method, 'PATCH');
      return response({ id: 1, draft: false });
    },
  });
  assert(urls.some((url) => url.includes('page=2')));
  assert(!methods.includes('POST'));
});

test('first release creates a tag and draft, uploads all files, then publishes', async () => {
  const calls = [];
  await publishGithub({
    env,
    loadRelease,
    loadFile,
    fetchImpl: async (url, options) => {
      calls.push({ url, method: options.method });
      if (url.includes('/git/ref/tags/')) return response({}, 404);
      if (url.endsWith('/git/refs')) {
        assert.deepEqual(JSON.parse(options.body), {
          ref: 'refs/tags/v0.2.0',
          sha: env.GITHUB_SHA,
        });
        return response({ object: { type: 'commit', sha: env.GITHUB_SHA } });
      }
      if (url.includes('/releases/tags/')) return response({}, 404);
      if (url.includes('/releases?')) return response([]);
      if (url.endsWith('/releases')) {
        assert.equal(JSON.parse(options.body).draft, true);
        return response({
          id: 1,
          draft: true,
          assets: [],
          upload_url:
            'https://uploads.github.com/repos/owner/project/releases/1/assets{?name,label}',
        });
      }
      if (url.startsWith('https://uploads.github.com')) {
        return response({ digest: `sha256:${sha256(options.body)}` });
      }
      assert.equal(options.method, 'PATCH');
      assert.deepEqual(JSON.parse(options.body), { draft: false });
      return response({ id: 1, draft: false });
    },
  });
  assert.equal(calls.filter((call) => call.method === 'POST').length, 5);
  assert.equal(calls.at(-1).method, 'PATCH');
});
