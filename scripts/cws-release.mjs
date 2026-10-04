import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readRelease } from './release-package.mjs';
import { compareVersions } from './release-check.mjs';

const origin = 'https://chromewebstore.googleapis.com';
const knownStates = new Set([
  'PENDING_REVIEW',
  'STAGED',
  'PUBLISHED',
  'PUBLISHED_TO_TESTERS',
  'REJECTED',
  'CANCELLED',
]);

export function summarizeStatus(status) {
  const revision = (value) =>
    value
      ? {
          state: value.state,
          versions: (value.distributionChannels ?? []).map((channel) => channel.crxVersion),
        }
      : null;
  return {
    published: revision(status.publishedItemRevisionStatus),
    submitted: revision(status.submittedItemRevisionStatus),
    upload: status.lastAsyncUploadState ?? null,
    takenDown: status.takenDown === true,
    warned: status.warned === true,
  };
}

export function submissionDecision(status, version) {
  assert(
    !status.takenDown && !status.warned,
    '스토어 경고·게시 중단을 대시보드에서 먼저 해결해 주세요.'
  );
  assert(
    status.lastAsyncUploadState !== 'IN_PROGRESS',
    '다른 업로드가 진행 중입니다. 완료 후 다시 실행해 주세요.'
  );
  const submitted = status.submittedItemRevisionStatus;
  const published = status.publishedItemRevisionStatus;
  for (const revision of [submitted, published]) {
    if (revision)
      assert(
        knownStates.has(revision.state),
        '알 수 없는 스토어 상태입니다. 대시보드를 확인해 주세요.'
      );
  }
  assert(
    submitted?.state !== 'STAGED',
    '이미 승인 대기 중인 버전이 있습니다. 자동으로 공개하거나 덮어쓰지 않습니다.'
  );
  if (submitted?.state === 'PENDING_REVIEW') {
    const versions = submitted.distributionChannels?.map((channel) => channel.crxVersion) ?? [];
    if (versions.includes(version)) return 'already-submitted';
    throw new Error(
      '다른 버전이 심사 중입니다. 심사를 취소하지 않았습니다. 완료 후 다시 실행해 주세요.'
    );
  }
  const publishedVersions =
    published?.distributionChannels?.map((channel) => channel.crxVersion) ?? [];
  if (publishedVersions.includes(version)) return 'already-published';
  for (const revision of [submitted, published]) {
    for (const channel of revision?.distributionChannels ?? []) {
      assert(
        compareVersions(version, channel.crxVersion) > 0,
        '스토어에 전송한 버전보다 높은 새 버전이 필요합니다.'
      );
    }
  }
  return 'submit';
}

export async function runStore({
  operation,
  env = process.env,
  fetchImpl = fetch,
  loadRelease = readRelease,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  assert(['status', 'submit'].includes(operation), 'status 또는 submit만 사용할 수 있습니다.');
  // Deliberately before token, file and network access: unset/false is a hard off switch.
  if (operation === 'submit' && env.CWS_SUBMIT_ENABLED !== 'true') return { result: 'disabled' };
  assert.match(env.CWS_PUBLISHER_ID ?? '', /^[a-zA-Z0-9_-]+$/, 'CWS_PUBLISHER_ID가 필요합니다.');
  assert.match(env.CWS_EXTENSION_ID ?? '', /^[a-p]{32}$/, 'CWS_EXTENSION_ID가 필요합니다.');
  assert(env.CWS_ACCESS_TOKEN, 'WIF로 생성한 CWS_ACCESS_TOKEN이 필요합니다.');
  const name = `publishers/${env.CWS_PUBLISHER_ID}/items/${env.CWS_EXTENSION_ID}`;
  const statusUrl = `${origin}/v2/${name}:fetchStatus`;
  const request = async (url, options = {}) => {
    let response;
    try {
      response = await fetchImpl(url, {
        ...options,
        headers: { Authorization: `Bearer ${env.CWS_ACCESS_TOKEN}`, ...options.headers },
        signal: AbortSignal.timeout(options.method === 'POST' ? 120000 : 30000),
      });
    } catch {
      throw new Error(
        '스토어 API 응답을 확인하지 못했습니다. 자동 재전송하지 않았습니다. status로 상태를 확인해 주세요.'
      );
    }
    assert(
      response.ok,
      `스토어 API HTTP ${response.status}: 대시보드와 인증 설정을 확인해 주세요. 자동 재전송하지 않았습니다.`
    );
    return response.json();
  };
  const initial = await request(statusUrl);
  if (operation === 'status') return { result: 'status', ...summarizeStatus(initial) };
  const { metadata, bytes } = await loadRelease();
  const decision = submissionDecision(initial, metadata.version);
  if (decision !== 'submit') return { result: decision, ...summarizeStatus(initial) };
  const uploaded = await request(`${origin}/upload/v2/${name}:upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip' },
    body: bytes,
  });
  let state = uploaded.uploadState;
  assert(
    ['SUCCEEDED', 'IN_PROGRESS'].includes(state),
    '업로드에 실패했습니다. 대시보드를 확인해 주세요.'
  );
  if (uploaded.crxVersion)
    assert.equal(
      uploaded.crxVersion,
      metadata.version,
      '업로드 버전이 다릅니다. 제출하지 않았습니다.'
    );
  for (let attempt = 0; state === 'IN_PROGRESS' && attempt < 30; attempt++) {
    await wait(2000);
    const status = await request(statusUrl);
    state = status.lastAsyncUploadState;
    assert(
      ['SUCCEEDED', 'IN_PROGRESS'].includes(state),
      '비동기 업로드가 실패했거나 상태를 확인할 수 없습니다.'
    );
  }
  assert.equal(
    state,
    'SUCCEEDED',
    '업로드 처리가 아직 끝나지 않았습니다. 대시보드를 확인해 주세요. 제출하지 않았습니다.'
  );
  // Check again because a maintainer may have submitted manually during the upload.
  const current = await request(statusUrl);
  const currentDecision = submissionDecision(current, metadata.version);
  if (currentDecision !== 'submit') return { result: currentDecision, ...summarizeStatus(current) };
  const published = await request(`${origin}/v2/${name}:publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publishType: 'DEFAULT_PUBLISH',
      skipReview: false,
      blockOnWarnings: true,
    }),
  });
  assert(
    ['PENDING_REVIEW', 'PUBLISHED'].includes(published.state),
    '제출 결과를 대시보드에서 확인해 주세요. 자동 재전송하지 않았습니다.'
  );
  return { result: 'submitted', version: metadata.version, state: published.state };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runStore({ operation: process.argv[2] })
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
