import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaults } from '@/shared/model/preferences';
import {
  commitBackgroundAsset,
  decodeBackgroundImage,
  discardBackgroundAsset,
  pendingBackgroundAsset,
  resolveBackgroundImage,
  rollbackBackgroundAsset,
  stageBackgroundAsset,
} from './background-assets';
import {
  BACKGROUND_FILE_LIMIT,
  backgroundAssetReferences,
  validateBackgroundFile,
  validateImageSignature,
} from './background-asset-policy';

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
function file() {
  return Object.assign(new NodeBlob([png], { type: 'image/png' }), {
    name: 'paper.png',
  }) as unknown as File;
}
let images: TestImage[];
class TestImage {
  naturalWidth = 64;
  naturalHeight = 64;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  decode = vi.fn().mockResolvedValue(undefined);
  private value = '';
  constructor() {
    images.push(this);
  }
  set src(value: string) {
    this.value = value;
    if (value.startsWith('blob:')) queueMicrotask(() => this.onload?.());
  }
  get src() {
    return this.value;
  }
}
const sendMessage = vi.fn();
beforeEach(() => {
  images = [];
  vi.stubGlobal('Image', TestImage);
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  vi.stubGlobal(
    'URL',
    class extends URL {
      static override createObjectURL = vi.fn(() => 'blob:test-image');
      static override revokeObjectURL = vi.fn();
    }
  );
  sendMessage.mockReset().mockResolvedValue({ ok: true, data: null });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('local background assets', () => {
  it('rejects unsupported, oversized and disguised image files before storing them', () => {
    expect(() => validateBackgroundFile({ type: 'image/svg+xml', size: 100 })).toThrow('JPEG');
    expect(() =>
      validateBackgroundFile({ type: 'image/png', size: BACKGROUND_FILE_LIMIT + 1 })
    ).toThrow('10MiB');
    expect(() =>
      validateImageSignature(new Uint8Array([60, 115, 118, 103]), 'image/png')
    ).toThrow();
    expect(() => validateImageSignature(png, 'image/png')).not.toThrow();
  });
  it('keeps draft files in memory, writes once only on commit, and never includes bytes in settings', async () => {
    const id = await stageBackgroundAsset(file());
    const draft = { ...defaults, backgroundImageSource: 'file' as const, backgroundAssetId: id };
    expect(sendMessage).not.toHaveBeenCalled();
    expect(pendingBackgroundAsset(id)?.name).toBe('paper.png');
    const [first, second] = await Promise.all([
      commitBackgroundAsset(draft),
      commitBackgroundAsset(draft),
    ]);
    expect(first.backgroundAssetId).not.toMatch(/^pending:/);
    expect(second.backgroundAssetId).toBe(first.backgroundAssetId);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]![0]).toMatchObject({
      action: 'write',
      type: 'image/png',
      data: expect.any(String),
    });
    expect(Object.keys(first).sort()).toEqual(Object.keys(draft).sort());
    discardBackgroundAsset(draft);
    expect(pendingBackgroundAsset(id)).toBeUndefined();
  });
  it('a failed write retains the draft and can retry without changing its permanent identity', async () => {
    const id = await stageBackgroundAsset(file());
    const draft = { ...defaults, backgroundAssetId: id };
    sendMessage.mockResolvedValueOnce({ ok: false, error: 'disk full' });
    await expect(commitBackgroundAsset(draft)).rejects.toThrow('disk full');
    expect(pendingBackgroundAsset(id)).toBeDefined();
    await commitBackgroundAsset(draft);
    expect(sendMessage.mock.calls[0]![0].id).toBe(sendMessage.mock.calls[1]![0].id);
    discardBackgroundAsset(draft);
  });
  it('can roll back the image write after a preset save fails without losing the draft file', async () => {
    const id = await stageBackgroundAsset(file());
    const draft = { ...defaults, backgroundAssetId: id };
    const saved = await commitBackgroundAsset(draft);
    await rollbackBackgroundAsset(draft);
    expect(sendMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'remove', id: saved.backgroundAssetId })
    );
    expect(pendingBackgroundAsset(id)).toBeDefined();
    await commitBackgroundAsset(draft);
    expect(sendMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'write', id: saved.backgroundAssetId })
    );
    discardBackgroundAsset(draft);
  });
  it('protects current and saved preset references, including a temporarily inactive file background', () => {
    expect(
      backgroundAssetReferences(
        {
          'unp.reader.v1': { data: { backgroundType: 'color', backgroundAssetId: 'one' } },
          'unp.preset.v1.p1': { name: '밤', settings: { backgroundAssetId: 'one' } },
          'unp.migration.settings.v1': { data: { backgroundAssetId: 'one' } },
        },
        'one'
      )
    ).toEqual(['현재 읽기 설정', '밤']);
  });
  it('does not finish before decoding and ignores an aborted image even if its load callback arrives later', async () => {
    const abort = new AbortController();
    const pending = decodeBackgroundImage('https://example.test/slow.png', abort.signal);
    const lateLoad = images[0]!.onload;
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    lateLoad?.();
    expect(images[0]!.src).toBe('');
  });
  it('expires a stalled image request instead of leaving a spinner indefinitely', async () => {
    vi.useFakeTimers();
    const pending = decodeBackgroundImage('https://example.test/stalled.png');
    const expected = expect(pending).rejects.toThrow('응답이 늦습니다');
    await vi.advanceTimersByTimeAsync(15000);
    await expected;
  });
  it('reuses the decoded local URL across preview mounts and releases it after draft disposal', async () => {
    const id = await stageBackgroundAsset(file());
    const settings = {
      ...defaults,
      backgroundType: 'image' as const,
      backgroundImageSource: 'file' as const,
      backgroundAssetId: id,
    };
    const loaded = await resolveBackgroundImage(settings);
    const before = vi.mocked(URL.revokeObjectURL).mock.calls.length;
    const decoded = images.length;
    loaded?.release();
    loaded?.release();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(before);
    const reopened = await resolveBackgroundImage(settings);
    expect(reopened?.url).toBe(loaded?.url);
    expect(reopened?.reused).toBe(true);
    expect(images).toHaveLength(decoded);
    discardBackgroundAsset(settings);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(before);
    reopened?.release();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(before + 1);
    sendMessage.mockResolvedValueOnce({ ok: false, error: '이미지 다시 등록이 필요합니다.' });
    await expect(
      resolveBackgroundImage({ ...settings, backgroundAssetId: crypto.randomUUID() })
    ).rejects.toThrow('다시 등록');
  });
});
