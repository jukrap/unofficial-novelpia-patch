import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function versionParts(version) {
  assert.match(
    version,
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/,
    '버전은 x.y.z 형식이어야 합니다.'
  );
  const parts = version.split('.').map(Number);
  assert(
    parts.every((part) => part <= 65535),
    'Chrome 버전 각 부분은 65535 이하여야 합니다.'
  );
  assert(
    parts.some((part) => part > 0),
    '0.0.0은 배포할 수 없습니다.'
  );
  return parts;
}

export function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return Math.sign(a[i] - b[i]);
  return 0;
}

export function releaseNotes(changelog, version) {
  const heading = `## [${version}]`;
  const sections = changelog.replaceAll('\r\n', '\n').split(/(?=^## )/m);
  const section = sections.find((entry) => entry.startsWith(`${heading} - `));
  assert(section, `CHANGELOG.md에 ${heading} - YYYY-MM-DD 항목이 필요합니다.`);
  const [line, ...body] = section.split('\n');
  assert.match(line, /^## \[\d+\.\d+\.\d+\] - \d{4}-\d{2}-\d{2}$/);
  const notes = body.join('\n').trim();
  assert(notes.length > 0, '릴리스 변경 설명이 비어 있습니다.');
  return `${notes}\n`;
}

export function validateRelease({ pkg, lock, changelog, baseVersion }) {
  versionParts(pkg.version);
  assert.equal(lock.version, pkg.version, 'package-lock.json 버전이 다릅니다.');
  assert.equal(lock.packages?.['']?.version, pkg.version, 'lockfile 루트 버전이 다릅니다.');
  assert.equal(lock.name, pkg.name, 'lockfile 패키지 이름이 다릅니다.');
  assert.equal(lock.packages?.['']?.name, pkg.name, 'lockfile 루트 이름이 다릅니다.');
  if (baseVersion) {
    assert(compareVersions(pkg.version, baseVersion) > 0, 'main 반영 전 버전을 올려야 합니다.');
  }
  return { version: pkg.version, notes: releaseNotes(changelog, pkg.version) };
}

export function validatePullRequest(event) {
  const pr = event.pull_request;
  assert(pr && event.repository, 'PR 이벤트만 검사할 수 있습니다.');
  assert.match(
    pr.title,
    /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9][a-z0-9-]*\))?!?:\s+\S.+$/u,
    'PR 제목은 type(scope): 설명 형식이어야 합니다.'
  );
  if (pr.base.ref === 'main') {
    assert.equal(pr.head.ref, 'develop', 'main에는 develop PR만 병합합니다.');
    assert.equal(
      pr.head.repo?.id,
      event.repository.id,
      '포크의 develop은 main에 병합할 수 없습니다.'
    );
  } else {
    assert.equal(pr.base.ref, 'develop', '기여 PR은 develop으로 보내 주세요.');
  }
}

async function main() {
  if (process.argv[2] === 'pr-policy') {
    validatePullRequest(JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8')));
    console.log('PR 출발 브랜치와 제목을 확인했습니다.');
    return;
  }
  const [pkg, lock, changelog] = await Promise.all([
    readFile('package.json', 'utf8').then(JSON.parse),
    readFile('package-lock.json', 'utf8').then(JSON.parse),
    readFile('CHANGELOG.md', 'utf8'),
  ]);
  let base = process.env.RELEASE_BASE_SHA;
  if (base && /^0+$/.test(base)) base = undefined;
  if (base) assert.match(base, /^[a-f0-9]{40}$/, '기준 커밋 SHA가 올바르지 않습니다.');
  const baseVersion = base
    ? JSON.parse(execFileSync('git', ['show', `${base}:package.json`], { encoding: 'utf8' }))
        .version
    : undefined;
  const result = validateRelease({ pkg, lock, changelog, baseVersion });
  console.log(`릴리스 ${result.version}: 버전·lockfile·변경 이력을 확인했습니다.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
