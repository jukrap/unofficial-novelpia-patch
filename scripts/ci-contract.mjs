import { createHash } from 'node:crypto';

// Explicit documentation paths only: unknown files must receive full verification.
export function isDocumentation(file) {
  return (
    /^(?:README|CONTRIBUTING|CHANGELOG|SECURITY|LICENSE)(?:\.md)?$/.test(file) ||
    /^(?:(?:docs|store)\/.*\.(?:md|png|webp|jpg|svg)$|\.github\/(?:ISSUE_TEMPLATE\/[^/]+\.(?:yml|yaml|md)$|PULL_REQUEST_TEMPLATE\.md$|CODEOWNERS$))/.test(
      file
    )
  );
}

export function inputFingerprint(entries) {
  return createHash('sha256')
    .update(
      JSON.stringify(
        entries
          .filter(
            (entry) =>
              entry.type !== 'tree' && (entry.mode !== '100644' || !isDocumentation(entry.path))
          )
          .map(({ path, mode, sha }) => [path, mode, sha])
          .sort((a, b) => a[0].localeCompare(b[0], 'en'))
      )
    )
    .digest('hex');
}

export function checkScope(files) {
  const code = files.filter((file) => !isDocumentation(file));
  if (!code.length) return { mode: 'docs', suites: [] };
  const suites = new Set();
  for (const file of code) {
    if (/^tests\/unit\/.*\.test\.[cm]?[jt]sx?$/.test(file)) continue;
    if (/^tests\/e2e\/[\w-]+\.spec\.ts$/.test(file) && !file.includes('live.spec')) {
      suites.add(file);
    } else if (file.startsWith('src/pages/popup/')) {
      suites.add('tests/e2e/management.spec.ts');
    } else {
      return { mode: 'full', suites: [] };
    }
  }
  return { mode: suites.size ? 'focused' : 'unit', suites: [...suites].sort() };
}

export function packageReleaseInput(pkg) {
  // Test/maintenance commands do not change the shipped extension.
  const { scripts, ...metadata } = pkg;
  return {
    ...metadata,
    scripts: Object.fromEntries(
      Object.entries(scripts ?? {}).filter(([name]) =>
        /^(?:prepare|build(?::.*)?|zip|icons:generate)$/.test(name)
      )
    ),
  };
}

export function affectsRelease(file) {
  if (isDocumentation(file)) return false;
  // Store artwork exporters are verified tools, but are not shipped in the extension.
  if (/^scripts\/store-(?:assets|artwork|promo)\.mjs$/.test(file)) return false;
  return !/^(?:tests\/|\.github\/|scripts\/(?:ci-|qa-|release-|cws-|fsd-rule)|playwright\.config\.|vitest\.config\.|eslint\.config\.|\.prettier|\.gitignore$)/.test(
    file
  );
}

export function successfulFullRun(run, jobs, { repository, repositoryId, now = Date.now() }) {
  const age = now - Date.parse(run.updated_at);
  return (
    run.status === 'completed' &&
    run.conclusion === 'success' &&
    run.path === '.github/workflows/ci.yml' &&
    run.repository?.id === repositoryId &&
    run.head_repository?.id === repositoryId &&
    run.head_repository?.full_name === repository &&
    ['pull_request', 'push', 'workflow_dispatch'].includes(run.event) &&
    age >= 0 &&
    age <= 24 * 60 * 60 * 1000 &&
    ['Static and package', 'MV3 (Windows)'].every((name) =>
      jobs.some((job) => job.name === name && job.conclusion === 'success')
    ) &&
    jobs.some(
      (job) =>
        job.name === 'MV3 suite' &&
        job.conclusion === 'success' &&
        job.steps?.some(
          (step) => step.name === 'Run full MV3 suite' && step.conclusion === 'success'
        )
    )
  );
}

export function canReuseBrowserEvidence(eventName, operation) {
  return eventName !== 'workflow_dispatch' || operation === 'release';
}
