import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const [repository, ...options] = process.argv.slice(2);
assert.match(repository ?? '', /^[\w.-]+\/[\w.-]+$/, 'OWNER/REPOSITORY를 지정해 주세요.');
assert(
  options.every((option) => option === '--apply'),
  '지원 옵션은 --apply입니다.'
);
const apply = options.includes('--apply');
const labels = JSON.parse(
  await readFile(new URL('../.github/labels.json', import.meta.url), 'utf8')
);
assert(Array.isArray(labels) && labels.length > 0, '라벨 목록이 비어 있습니다.');
const names = new Set();
for (const label of labels) {
  assert(typeof label.name === 'string' && label.name.trim() === label.name);
  assert(label.name.length > 0 && label.name.length <= 50, '라벨 이름은 1~50자여야 합니다.');
  assert.match(label.color, /^[\da-f]{6}$/i, '색상은 # 없이 6자리 HEX로 적어 주세요.');
  assert(typeof label.description === 'string' && label.description.length <= 100);
  const key = label.name.toLowerCase();
  assert(!names.has(key), `중복 라벨: ${label.name}`);
  names.add(key);
}
const api = (path, method = 'GET', body, paginate = false) =>
  JSON.parse(
    execFileSync(
      'gh',
      [
        'api',
        path,
        '--method',
        method,
        ...(paginate ? ['--paginate', '--slurp'] : []),
        ...(body ? ['--input', '-'] : []),
      ],
      { encoding: 'utf8', ...(body ? { input: JSON.stringify(body) } : {}) }
    )
  );
const repo = api(`repos/${repository}`);
assert.equal(repo.full_name.toLowerCase(), repository.toLowerCase());
if (apply) {
  assert(
    repo.permissions?.admin ||
      repo.permissions?.maintain ||
      repo.permissions?.push ||
      repo.permissions?.triage,
    '라벨을 관리할 수 있는 저장소 권한이 필요합니다.'
  );
}
const fetchLabels = () =>
  api(`repos/${repository}/labels?per_page=100`, 'GET', undefined, true).flat();
const plan = (existing) =>
  labels.flatMap((label) => {
    const current = existing.find((item) => item.name.toLowerCase() === label.name.toLowerCase());
    if (!current) return [{ action: 'create', label }];
    if (
      current.color.toLowerCase() === label.color.toLowerCase() &&
      (current.description ?? '') === label.description
    )
      return [];
    return [{ action: 'update', label, name: current.name }];
  });
const existing = fetchLabels();
const changes = plan(existing);
console.log(`${repository}: ${apply ? 'apply' : 'preview'} (${changes.length} changes)`);
for (const change of changes) console.log(`${change.action}: ${change.label.name}`);
if (apply) {
  for (const change of changes) {
    if (change.action === 'create') api(`repos/${repository}/labels`, 'POST', change.label);
    else {
      api(`repos/${repository}/labels/${encodeURIComponent(change.name)}`, 'PATCH', {
        color: change.label.color,
        description: change.label.description,
      });
    }
  }
  const verified = fetchLabels();
  assert.equal(plan(verified).length, 0, '원격 라벨이 목록과 다릅니다. 다시 확인해 주세요.');
  assert(existing.every((label) => verified.some((item) => item.name === label.name)));
  console.log(`${labels.length}개 라벨 확인 완료. 기존 라벨의 이름과 연결은 유지했습니다.`);
} else {
  console.log(
    '원격 설정은 변경하지 않았습니다. --apply로 적용하며 목록 밖의 라벨은 삭제하지 않습니다.'
  );
}
