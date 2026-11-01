import type {
  FullConfig,
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
// @ts-expect-error Shared Node-only maintenance module.
import { createWorkspace } from '../../scripts/qa-workspace.mjs';

export default class QaReporter implements Reporter {
  private output = '';
  private results: { test: string; status: string; durationMs: number; errors: string[] }[] = [];
  onBegin(config: FullConfig) {
    this.output = config.projects[0]!.outputDir;
  }
  onTestEnd(test: TestCase, result: TestResult) {
    this.results.push({
      test: test.titlePath().join(' > '),
      status: result.status,
      durationMs: result.duration,
      errors: result.errors.map((error) => error.message ?? String(error)),
    });
  }
  async onEnd(result: FullResult) {
    await mkdir(this.output, { recursive: true });
    await writeFile(
      path.join(this.output, 'summary.json'),
      JSON.stringify(
        {
          status: result.status,
          durationMs: result.duration,
          tests: this.results,
        },
        null,
        2
      )
    );
    // Never copy real novel screenshots into synthetic results or public artifacts.
    if (result.status !== 'passed' && !process.env.UNP_LIVE && !process.env.UNP_FONTS_LIVE) {
      const directory: string = await createWorkspace('failures');
      await cp(this.output, path.join(directory, 'results'), { recursive: true });
      console.log(`Failure evidence: ${path.relative(process.cwd(), directory)}`);
    }
  }
}
