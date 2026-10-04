import { describe, expect, it, vi } from 'vitest';
import { SETTINGS_KEY, defaults } from '@/entities/settings';
import { memoryStorage } from '../../../tests/helpers/storage';
import { createViewerModeService } from './viewer-mode-service';

function setup(connected = false) {
  const db = memoryStorage({ [SETTINGS_KEY]: { schemaVersion: 1, data: defaults } });
  const port = {
    current: vi.fn(async () => 7),
    probe: vi.fn(async () => (connected ? { documentKey: 'current-document' } : null)),
    change: vi.fn(async (_tabId: number, _document: string, _enabled: boolean) => {}),
  };
  return { db, port, service: createViewerModeService(db.port, port) };
}

describe('popup viewer mode command', () => {
  it('saves the global preference without reloading an unrelated page', async () => {
    const { db, port, service } = setup();
    expect(await service.status()).toMatchObject({ connected: false, enabled: true });
    expect(await service.setEnabled(false)).toEqual({ ok: true, connected: false });
    expect(db.syncData[SETTINGS_KEY]).toMatchObject({ data: { enabled: false } });
    expect(port.change).not.toHaveBeenCalled();
  });

  it('lets the matching reader document save and restore before it reloads', async () => {
    const { db, port, service } = setup(true);
    expect(await service.setEnabled(false)).toEqual({ ok: true, connected: true });
    expect(port.change).toHaveBeenCalledWith(7, 'current-document', false);
    // The background must not race the content store with its own settings write.
    expect(db.syncData[SETTINGS_KEY]).toMatchObject({ data: { enabled: true } });
  });

  it('does not fall back to a global write after a reader save or document check fails', async () => {
    const { db, port, service } = setup(true);
    port.change.mockRejectedValueOnce(new Error('회차가 바뀌었습니다.'));
    await expect(service.setEnabled(false)).rejects.toThrow('회차가 바뀌었습니다.');
    expect(db.syncData[SETTINGS_KEY]).toMatchObject({ data: { enabled: true } });
    await expect(service.setEnabled(false)).resolves.toMatchObject({ ok: true });
  });

  it('reports persistence failure and allows the next command to retry', async () => {
    const { db, service } = setup();
    db.fail();
    await expect(service.setEnabled(false)).rejects.toThrow('저장하지 못했습니다.');
    expect(db.syncData[SETTINGS_KEY]).toMatchObject({ data: { enabled: true } });
    db.fail(false);
    await expect(service.setEnabled(false)).resolves.toMatchObject({ ok: true });
    expect(db.syncData[SETTINGS_KEY]).toMatchObject({ data: { enabled: false } });
  });
});
