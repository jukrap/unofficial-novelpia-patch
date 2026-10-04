import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const repository = process.argv[2];
assert.match(repository ?? '', /^[\w.-]+\/[\w.-]+$/, 'OWNER/REPOSITORY를 지정해 주세요.');
const apply = process.argv.includes('--apply');
const api = (path, method = 'GET', body) =>
  JSON.parse(
    execFileSync('gh', ['api', path, '--method', method, ...(body ? ['--input', '-'] : [])], {
      encoding: 'utf8',
      ...(body ? { input: JSON.stringify(body) } : {}),
    })
  );
const repo = api(`repos/${repository}`);
assert.equal(repo.full_name.toLowerCase(), repository.toLowerCase());
assert(repo.permissions?.admin, '저장소 관리자 권한이 필요합니다.');
const files = await Promise.all(
  ['main', 'develop'].map(async (branch) => {
    const rule = JSON.parse(await readFile(`.github/rulesets/${branch}.json`, 'utf8'));
    assert.deepEqual(rule.conditions.ref_name.include, [`refs/heads/${branch}`]);
    assert.deepEqual(rule.bypass_actors, []);
    assert.equal(rule.enforcement, 'active');
    const pr = rule.rules.find((entry) => entry.type === 'pull_request').parameters;
    assert(Array.isArray(pr.allowed_merge_methods));
    return rule;
  })
);
console.log(
  `${repository}: ${repo.private ? 'private' : 'public'}, ${apply ? 'apply' : 'preview'}`
);
if (!apply) {
  console.log(files.map((rule) => `${rule.name}: PR 및 필수 검사, 우회 없음`).join('\n'));
  console.log('설정은 변경하지 않았습니다. --apply는 공개 전환 검토 후에만 사용하세요.');
} else {
  assert(!repo.private, '이 프로젝트는 비공개 검토 중입니다. 공개 전환 전에는 적용하지 않습니다.');
  const existing = api(`repos/${repository}/rulesets?includes_parents=false&per_page=100`);
  for (const rule of files) {
    const matches = existing.filter((entry) => entry.name === rule.name);
    assert(matches.length <= 1, `중복 규칙을 먼저 확인해 주세요: ${rule.name}`);
    const current = matches[0];
    const path = `repos/${repository}/rulesets${current ? `/${current.id}` : ''}`;
    const saved = api(path, current ? 'PUT' : 'POST', rule);
    const verified = api(`repos/${repository}/rulesets/${saved.id}`);
    assert.equal(verified.enforcement, 'active');
    assert.deepEqual(verified.bypass_actors ?? [], []);
    console.log(`${verified.name}: ${verified.id}, active`);
  }
}
