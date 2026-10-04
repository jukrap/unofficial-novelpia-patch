import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createZip } from './release-archive.mjs';
import { validateRelease, versionParts } from './release-check.mjs';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const viewerMatches = ['https://novelpia.com/viewer/*', 'https://www.novelpia.com/viewer/*'];
const resourceMatches = ['https://novelpia.com/*', 'https://www.novelpia.com/*'];

async function readTree(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = new Map();
  for (const entry of entries) {
    assert(!entry.isSymbolicLink(), `심볼릭 링크는 배포하지 않습니다: ${prefix}${entry.name}`);
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      for (const [name, bytes] of await readTree(resolve(directory, entry.name), `${path}/`))
        files.set(name, bytes);
    } else {
      files.set(path, await readFile(resolve(directory, entry.name)));
    }
  }
  return files;
}

export function validatePackage(files, expectedVersion) {
  const getJson = (path) => {
    assert(files.has(path), `배포 파일이 없습니다: ${path}`);
    return JSON.parse(files.get(path).toString('utf8'));
  };
  const has = (path) => assert(files.has(path.replace(/^\//, '')), `참조 파일이 없습니다: ${path}`);
  const manifest = getJson('manifest.json');
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, expectedVersion);
  assert.deepEqual(manifest.permissions, ['storage'], '배포 권한 변경을 별도로 검토해야 합니다.');
  for (const key of ['host_permissions', 'optional_permissions', 'optional_host_permissions']) {
    assert(!manifest[key]?.length, `승인하지 않은 권한: ${key}`);
  }
  assert(
    !manifest.key && !manifest.update_url,
    '개발용 키나 별도 업데이트 서버를 배포하지 않습니다.'
  );
  assert(manifest.content_scripts?.length > 0, '뷰어 콘텐츠 스크립트가 없습니다.');
  for (const script of manifest.content_scripts) {
    assert.deepEqual([...script.matches].sort(), viewerMatches, '프로덕션 사이트 범위가 다릅니다.');
    for (const path of [...(script.js ?? []), ...(script.css ?? [])]) has(path);
  }
  for (const path of [
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    manifest.options_ui?.page,
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action?.default_icon ?? {}),
  ])
    if (path) has(path);
  assert(manifest.web_accessible_resources?.length > 0, '지연 청크 공개 설정이 없습니다.');
  for (const resources of manifest.web_accessible_resources) {
    assert.deepEqual([...resources.matches].sort(), resourceMatches, '자원 공개 범위가 다릅니다.');
    assert(!resources.extension_ids?.length, '다른 확장에 자원을 공개하지 않습니다.');
    for (const resource of resources.resources) {
      if (resource.endsWith('/*'))
        assert([...files.keys()].some((path) => path.startsWith(resource.slice(0, -1))));
      else has(resource);
    }
  }
  for (const path of [
    'THIRD_PARTY_NOTICES.txt',
    'licenses/Freesentation-OFL.txt',
    'licenses/User-Font-Parser-Licenses.txt',
    'licenses/Reading-Font-Sources.txt',
  ])
    has(path);
  const startup = getJson('content-scripts/esm/startup.json');
  assert(Array.isArray(startup) && startup.includes('viewer.js'));
  for (const path of startup) has(`content-scripts/esm/${path}`);
  for (const [path, bytes] of files) {
    assert.match(
      path,
      /^(manifest\.json|(?:popup|options)\.html|(?:assets|chunks|content-scripts|fonts|icons|licenses)\/[\w./-]+|background\.js|THIRD_PARTY_NOTICES\.txt)$/i,
      `예상하지 않은 배포 경로: ${path}`
    );
    assert(
      !/(?:^|\/)(?:\.|test|fixture|debug)|\.(?:map|ts|tsx|mp4|zip)$|\.env|AGENTS\.md/i.test(path),
      `개발 전용 배포 파일: ${path}`
    );
    if (!/\.(js|html|css|json|txt)$/.test(path)) continue;
    const text = bytes.toString('utf8');
    assert(
      !/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?:[:/"']|$)/i.test(text),
      `개발용 주소가 포함되어 있습니다: ${path}`
    );
    assert(
      !/\.ai-agent-playbook|_reference\/|[A-Z]:[\\/]Users[\\/]|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/.test(
        text
      ),
      `개인 자료 또는 비밀 값 검사 실패: ${path}`
    );
    if (path.endsWith('.js')) {
      assert(
        !/\b(?:import|importScripts)\s*\(\s*["'](?:https?:)?\/\//.test(text),
        `원격 실행 자원을 배포하지 않습니다: ${path}`
      );
      for (const match of text.matchAll(/\b(?:from\s*|import\s*\(?\s*)["'](\.[^"']+\.js)["']/g)) {
        has(posix.normalize(posix.join(posix.dirname(path), match[1])));
      }
    }
    if (path.endsWith('.html')) {
      for (const match of text.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))["']/g)) {
        assert(!/^https?:/.test(match[1]), '원격 실행 자원을 배포하지 않습니다.');
        has(match[1].replace(/^\//, ''));
      }
    }
  }
  return manifest;
}

export async function packageRelease(root = process.cwd()) {
  const [pkg, lock, changelog, files] = await Promise.all([
    readFile(resolve(root, 'package.json'), 'utf8').then(JSON.parse),
    readFile(resolve(root, 'package-lock.json'), 'utf8').then(JSON.parse),
    readFile(resolve(root, 'CHANGELOG.md'), 'utf8'),
    readTree(resolve(root, '.output/chrome-mv3')),
  ]);
  const { version, notes } = validateRelease({ pkg, lock, changelog });
  validatePackage(files, version);
  const zip = createZip(files);
  const filename = `unofficial-novelpia-patch-${version}-chrome.zip`;
  const metadata = { version, filename, sha256: sha256(zip), bytes: zip.length };
  const out = resolve(root, '.output/release');
  await mkdir(out, { recursive: true });
  await Promise.all([
    writeFile(resolve(out, filename), zip),
    writeFile(resolve(out, 'SHA256SUMS'), `${metadata.sha256}  ${filename}\n`),
    writeFile(resolve(out, 'release.json'), `${JSON.stringify(metadata, null, 2)}\n`),
    writeFile(resolve(out, 'release-notes.md'), notes),
  ]);
  return metadata;
}

export async function readRelease(directory = '.output/release') {
  const metadata = JSON.parse(await readFile(resolve(directory, 'release.json'), 'utf8'));
  versionParts(metadata.version);
  assert.equal(metadata.filename, `unofficial-novelpia-patch-${metadata.version}-chrome.zip`);
  assert.match(metadata.sha256, /^[a-f0-9]{64}$/);
  const bytes = await readFile(resolve(directory, metadata.filename));
  assert.equal(bytes.length, metadata.bytes, 'ZIP 파일 크기가 다릅니다.');
  assert.equal(sha256(bytes), metadata.sha256, 'ZIP SHA-256이 다릅니다.');
  assert.equal(
    await readFile(resolve(directory, 'SHA256SUMS'), 'utf8'),
    `${metadata.sha256}  ${metadata.filename}\n`
  );
  return { metadata, bytes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  packageRelease()
    .then((metadata) => console.log(JSON.stringify(metadata, null, 2)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
