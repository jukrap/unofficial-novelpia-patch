import { describe, expect, it, vi } from 'vitest';
import { ReaderEngine } from './engine';

describe('seeking during a deferred service reflow', () => {
  it.each([
    [0, 1, false],
    [0.5, 13, false],
    [1, 23, false],
    [1, 23, true],
  ] as const)(
    'resolves progress %s against the settled page count',
    (progress, expectedPage, animate) => {
      const state = { pages: 22, columns: 2 };
      const cancelTransitions = () => {
        // Ending an effect releases the pending service layout. The recommendation
        // now pushes the remaining content into one additional column.
        state.pages = 23;
      };
      const goTo = vi.fn(() => cancelTransitions());
      const reader = {
        roots: { mode: 'page' },
        state,
        resume: { userIntent: vi.fn() },
        cancelTransitions,
        goTo,
      } as unknown as ReaderEngine;

      ReaderEngine.prototype.seek.call(reader, progress, animate);

      expect(goTo).toHaveBeenCalledWith(expectedPage, animate);
    }
  );
});
