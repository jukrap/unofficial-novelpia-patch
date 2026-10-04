import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readRelease, sha256 } from './release-package.mjs';

export async function publishGithub({
  env = process.env,
  fetchImpl = fetch,
  loadRelease = readRelease,
  loadFile = (name) => readFile(resolve('.output/release', name)),
} = {}) {
  assert.equal(env.GITHUB_REF, 'refs/heads/main', 'main에서만 릴리스를 발행합니다.');
  assert.match(env.GITHUB_REPOSITORY ?? '', /^[\w.-]+\/[\w.-]+$/);
  assert.match(env.GITHUB_SHA ?? '', /^[a-f0-9]{40}$/);
  assert(env.GITHUB_TOKEN, 'GitHub Actions의 GITHUB_TOKEN이 필요합니다.');
  const { metadata, bytes } = await loadRelease();
  const tag = `v${metadata.version}`;
  const root = `https://api.github.com/repos/${env.GITHUB_REPOSITORY}`;
  const request = async (path, { method = 'GET', body, missing = false } = {}) => {
    const response = await fetchImpl(`${root}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30000),
    });
    if (missing && response.status === 404) return null;
    assert(
      response.ok,
      `GitHub API HTTP ${response.status}. 기존 태그·파일은 덮어쓰지 않았습니다.`
    );
    return response.json();
  };
  let ref = await request(`/git/ref/tags/${tag}`, { missing: true });
  if (!ref)
    ref = await request('/git/refs', {
      method: 'POST',
      body: { ref: `refs/tags/${tag}`, sha: env.GITHUB_SHA },
    });
  assert.equal(ref.object.type, 'commit', '이미 존재하는 태그의 형식을 확인해 주세요.');
  assert.equal(
    ref.object.sha,
    env.GITHUB_SHA,
    '같은 버전 태그가 다른 커밋을 가리킵니다. 버전을 올려 주세요.'
  );
  let release = await request(`/releases/tags/${tag}`, { missing: true });
  if (!release) {
    // The tag endpoint exposes published releases; authenticated listing also
    // exposes drafts left behind by an interrupted upload.
    const matches = [];
    for (let page = 1; ; page++) {
      const listed = await request(`/releases?per_page=100&page=${page}`);
      assert(Array.isArray(listed), '릴리스 목록을 확인할 수 없습니다.');
      matches.push(...listed.filter((item) => item.tag_name === tag));
      if (listed.length < 100) break;
    }
    assert(
      matches.length <= 1,
      '같은 태그의 릴리스 초안이 여러 개 있습니다. 대시보드에서 확인해 주세요.'
    );
    release = matches[0];
  }
  if (!release)
    release = await request('/releases', {
      method: 'POST',
      body: {
        tag_name: tag,
        target_commitish: env.GITHUB_SHA,
        name: tag,
        body: (await loadFile('release-notes.md')).toString('utf8'),
        draft: true,
        prerelease: false,
      },
    });
  const assets = new Map([
    [metadata.filename, bytes],
    ['SHA256SUMS', await loadFile('SHA256SUMS')],
    ['release.json', await loadFile('release.json')],
  ]);
  for (const [name, content] of assets) {
    const existing = release.assets?.find((asset) => asset.name === name);
    if (existing) {
      assert(
        existing.state !== 'starter',
        `미완료 starter 파일이 남아 있습니다: ${name}. GitHub 릴리스 초안에서 해당 미완료 파일을 확인·제거한 뒤 다시 실행해 주세요. 자동 삭제하지 않았습니다.`
      );
      assert.equal(existing.size, content.length, `기존 릴리스 파일 크기가 다릅니다: ${name}`);
      // GitHub exposes a SHA-256 digest for assets uploaded with the REST API.
      assert.equal(
        existing.digest,
        `sha256:${sha256(content)}`,
        `기존 릴리스 파일 해시가 다릅니다: ${name}`
      );
      continue;
    }
    assert(release.draft, `공개된 릴리스에 파일이 없습니다: ${name}. 자동으로 수정하지 않습니다.`);
    const url = new URL(release.upload_url.replace(/\{.*$/, ''));
    assert.equal(url.origin, 'https://uploads.github.com');
    url.searchParams.set('name', name);
    const response = await fetchImpl(url.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        'Content-Type': name.endsWith('.zip') ? 'application/zip' : 'application/octet-stream',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: content,
      signal: AbortSignal.timeout(120000),
    });
    assert(
      response.ok,
      `릴리스 파일 업로드 실패 (${response.status}): ${name}. 초안을 유지합니다.`
    );
    const uploaded = await response.json();
    assert.equal(
      uploaded.digest,
      `sha256:${sha256(content)}`,
      'GitHub 업로드 해시가 다릅니다. 초안을 유지합니다.'
    );
  }
  if (release.draft)
    release = await request(`/releases/${release.id}`, { method: 'PATCH', body: { draft: false } });
  return { tag, sha: env.GITHUB_SHA, url: release.html_url };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  publishGithub()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
