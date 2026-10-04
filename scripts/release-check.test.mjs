import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateRawSync } from 'node:zlib';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createZip } from './release-archive.mjs';
import {
  compareVersions,
  readLockfile,
  validatePullRequest,
  validateRelease,
} from './release-check.mjs';
import { validatePackage } from './release-package.mjs';

function release(version = '0.2.0') {
  const pkg = {
    name: 'unofficial-novelpia-patch',
    version,
    packageManager: 'pnpm@12.9.1',
    dependencies: { react: '19.3.0' },
  };
  return {
    pkg,
    lock: {
      lockfileVersion: '9.0',
      importers: {
        '.': {
          dependencies: {
            react: { specifier: '19.3.0', version: '19.3.0' },
          },
        },
      },
    },
    changelog: `# 변경 이력\n\n## [${version}] - 2026-10-04\n\n- 읽기 환경을 개선했습니다.\n`,
    baseVersion: '0.1.0',
  };
}

test('release versions compare numerically and require a matching lockfile and notes', () => {
  assert.equal(validateRelease(release()).version, '0.2.0');
  assert(compareVersions('0.10.0', '0.9.9') > 0);
  assert.throws(() => validateRelease(release('0.1.0')), /버전을 올려/);
  assert.throws(() => validateRelease(release('0.1.0-beta')), /x.y.z/);
  assert.throws(() => validateRelease({ ...release(), changelog: '# 변경 이력' }), /CHANGELOG/);
  const mismatch = release();
  mismatch.lock.importers['.'].dependencies.react.specifier = '18.0.0';
  assert.throws(() => validateRelease(mismatch), /pnpm-lock/);
  const extra = release();
  extra.lock.importers['.'].dependencies.unexpected = { specifier: '1.0.0' };
  assert.throws(() => validateRelease(extra), /pnpm-lock/);
  const missing = release();
  delete missing.lock.importers['.'];
  assert.throws(() => validateRelease(missing), /루트 의존성/);
});

test('pnpm package manager metadata does not replace the application lock document', async () => {
  const root = await mkdtemp(join(tmpdir(), 'unp-lock-'));
  try {
    await writeFile(
      join(root, 'pnpm-lock.yaml'),
      '---\nlockfileVersion: "9.0"\nimporters: { .: { packageManagerDependencies: {} } }\n---\nlockfileVersion: "9.0"\nsettings: {}\nimporters: { .: { dependencies: { react: { specifier: "19.3.0" } } } }\n'
    );
    assert.equal(
      validateRelease({ ...release(), lock: await readLockfile(root) }).version,
      '0.2.0'
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('only the same repository develop PR may target main', () => {
  const event = {
    repository: { id: 1 },
    pull_request: {
      title: 'chore(release): 0.2.0 준비',
      base: { ref: 'main' },
      head: { ref: 'develop', repo: { id: 1 } },
    },
  };
  validatePullRequest(event);
  const fork = structuredClone(event);
  fork.pull_request.head.repo.id = 2;
  assert.throws(() => validatePullRequest(fork), /포크/);
  const wrongBranch = structuredClone(event);
  wrongBranch.pull_request.head.ref = 'feat/test';
  assert.throws(() => validatePullRequest(wrongBranch), /develop/);
  const contribution = structuredClone(event);
  contribution.pull_request.base.ref = 'develop';
  contribution.pull_request.head = { ref: 'fix/test', repo: { id: 2 } };
  contribution.pull_request.title = 'fix(reader): 읽기 위치를 보존';
  validatePullRequest(contribution);
  contribution.pull_request.title = 'changes';
  assert.throws(() => validatePullRequest(contribution), /PR 제목/);
});

function packageFiles() {
  const manifest = {
    manifest_version: 3,
    version: '0.1.0',
    permissions: ['storage'],
    content_scripts: [
      {
        matches: ['https://novelpia.com/viewer/*', 'https://www.novelpia.com/viewer/*'],
        js: ['content-scripts/content.js'],
      },
    ],
    web_accessible_resources: [
      {
        matches: ['https://novelpia.com/*', 'https://www.novelpia.com/*'],
        resources: ['content-scripts/esm/*'],
      },
    ],
  };
  return new Map(
    Object.entries({
      'manifest.json': JSON.stringify(manifest),
      'content-scripts/content.js': 'import("./esm/viewer.js")',
      'content-scripts/esm/viewer.js': 'import "./panel.js";',
      'content-scripts/esm/panel.js': 'export const panel = 1;',
      'content-scripts/esm/startup.json': '["viewer.js"]',
      'THIRD_PARTY_NOTICES.txt': 'Notices',
      'licenses/Freesentation-OFL.txt': 'OFL',
      'licenses/User-Font-Parser-Licenses.txt': 'MIT',
      'licenses/Reading-Font-Sources.txt': 'Sources',
    }).map(([path, bytes]) => [path, Buffer.from(bytes)])
  );
}

test('package validation catches test builds, private files, new permissions and missing chunks', () => {
  validatePackage(packageFiles(), '0.1.0');
  const missing = packageFiles();
  missing.delete('content-scripts/esm/panel.js');
  assert.throws(() => validatePackage(missing, '0.1.0'), /참조 파일/);
  const privateFiles = packageFiles();
  privateFiles.set('.env', Buffer.from('secret'));
  assert.throws(() => validatePackage(privateFiles, '0.1.0'), /배포 경로/);
  const testBuild = packageFiles();
  testBuild.set('content-scripts/content.js', Buffer.from('const origin="http://127.0.0.1/";'));
  assert.throws(() => validatePackage(testBuild, '0.1.0'), /개발용 주소/);
  const permissions = packageFiles();
  const manifest = JSON.parse(permissions.get('manifest.json'));
  manifest.permissions.push('tabs');
  permissions.set('manifest.json', Buffer.from(JSON.stringify(manifest)));
  assert.throws(() => validatePackage(permissions, '0.1.0'), /권한 변경/);
});

test('ZIP contains decodable files at root and identical bytes independent of input order', () => {
  const files = packageFiles();
  const zip = createZip(files);
  assert.deepEqual(createZip(new Map([...files].reverse())), zip);
  const decoded = new Map();
  let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = zip.readUInt32LE(offset + 18);
    const nameSize = zip.readUInt16LE(offset + 26);
    const name = zip.subarray(offset + 30, offset + 30 + nameSize).toString('utf8');
    const start = offset + 30 + nameSize;
    decoded.set(name, inflateRawSync(zip.subarray(start, start + compressedSize)));
    offset = start + compressedSize;
  }
  assert.equal(zip.readUInt32LE(offset), 0x02014b50);
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
  assert.equal(zip.readUInt16LE(zip.length - 12), files.size);
  assert.equal(zip.readUInt32LE(zip.length - 6), offset);
  assert.equal(decoded.size, files.size);
  for (const [path, bytes] of files) assert.deepEqual(decoded.get(path), bytes);
  assert.throws(() => createZip(new Map([['../secret', Buffer.from('bad')]])), /안전하지/);
  const crcFixture = createZip(new Map([['checksum.txt', Buffer.from('123456789')]]));
  assert.equal(crcFixture.readUInt32LE(14), 0xcbf43926, 'standard ZIP CRC-32 check vector');
});
