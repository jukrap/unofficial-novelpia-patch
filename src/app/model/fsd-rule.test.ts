import path from 'node:path';
import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';
// @ts-expect-error The production architecture rule is a Node-side JavaScript module.
import fsd from '../../../scripts/fsd-rule.mjs';

function violations(filename: string, source: string) {
  const linter = new Linter();
  return linter.verify(
    source,
    [
      {
        files: ['**/*.js'],
        languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
        plugins: { architecture: { rules: { fsd } } },
        rules: { 'architecture/fsd': 'error' },
      },
    ],
    { filename: path.resolve(filename) }
  );
}

describe('FSD public boundaries', () => {
  it.each([
    ['import { value } from "@/entities/reader/model/engine";', 'public'],
    ['export { value } from "@/entities/reader/model/engine";', 'public'],
    ['export * from "@/entities/reader/model/engine";', 'public'],
    ['const chunk = import("@/entities/reader/model/engine");', 'public'],
    ['const chunk = import("@/widgets/other");', 'slice'],
    ['const chunk = import("@/pages/options");', 'direction'],
    ['const chunk = import("../../../pages/options");', 'direction'],
  ])('rejects imports across a protected boundary: %s', (source, rule) => {
    const result = violations('src/widgets/settings-panel/ui/view.js', source);
    expect(result.some((message) => message.messageId === rule)).toBe(true);
    expect(result.some((message) => message.fatal)).toBe(false);
  });

  it.each([
    'const chunk = import("@/entities/reader");',
    'const chunk = import("./presets/preset-editor");',
    'const chunk = import("@/shared/ui/modal");',
    'const chunk = import("react");',
    'const chunk = import(runtimeUrl);',
  ])('allows public, local, shared and runtime imports: %s', (source) => {
    expect(violations('src/widgets/settings-panel/ui/view.js', source)).toEqual([]);
  });
});
