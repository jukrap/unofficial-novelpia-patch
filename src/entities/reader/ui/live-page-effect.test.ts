import { afterEach, describe, expect, it, vi } from 'vitest';
import { livePageEffect } from './live-page-effect';
import { animateElement } from '@/shared/lib/motion';
vi.mock('@/shared/lib/motion', () => ({ animateElement: vi.fn() }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('live service page turn', () => {
  it.each(['before', 'between', 'finished'] as const)(
    'commits once when stopped %s phases',
    async (stop) => {
      const phases: { resolve: () => void; cancel: ReturnType<typeof vi.fn> }[] = [];
      const animate = vi.fn(() => {
        let resolve!: () => void;
        const finished = new Promise<void>((done) => {
          resolve = done;
        });
        const cancel = vi.fn();
        phases.push({ resolve, cancel });
        return { finished, cancel };
      });
      const root = document.createElement('div'),
        body = document.createElement('div');
      root.append(body);
      vi.mocked(animateElement).mockImplementation(animate);
      const commit = vi.fn(),
        complete = vi.fn(() => release());
      const release = livePageEffect('paper', root, body, 1, commit, complete);
      expect(commit).not.toHaveBeenCalled();
      expect(root.dataset.unpLiveTurn).toBe('outgoing');
      if (stop !== 'before') {
        phases[0]!.resolve();
        await Promise.resolve();
        expect(commit).toHaveBeenCalledTimes(1);
        expect(root.dataset.unpLiveTurn).toBe('incoming');
      }
      if (stop === 'finished') {
        phases[1]!.resolve();
        await Promise.resolve();
        expect(complete).toHaveBeenCalledTimes(1);
      }
      release();
      release();
      phases.forEach((phase) => phase.resolve());
      await Promise.resolve();
      expect(commit).toHaveBeenCalledTimes(1);
      expect(root.hasAttribute('data-unp-live-turn')).toBe(false);
      expect(phases.every((phase) => phase.cancel.mock.calls.length > 0)).toBe(true);
    }
  );
  it('commits and releases state if the browser cannot start an animation', async () => {
    const root = document.createElement('div');
    vi.mocked(animateElement).mockImplementation(() => {
      throw new Error('animation unavailable');
    });
    const commit = vi.fn(),
      complete = vi.fn();
    const release = livePageEffect('slide', root, root, -1, commit, complete);
    await Promise.resolve();
    release();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(root.hasAttribute('data-unp-live-turn')).toBe(false);
  });
});
