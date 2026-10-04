import { chromeStorage, hasExtensionContext, type StoragePort } from '@/shared/platform/storage';
import {
  emptyStats,
  STATS_CHANNEL,
  STATS_KEYS,
  type ReadingStatsCommand,
  type ReadingStatsReport,
  type ReadingStatsSnapshot,
} from '../model/types';

export type StatsTransport = (command: ReadingStatsCommand) => Promise<ReadingStatsSnapshot>;

const send: StatsTransport = async (command) => {
  if (!hasExtensionContext())
    throw new Error('확장 연결이 종료되었습니다. 이 페이지를 새로고침해 주세요.');
  const reply = (await chrome.runtime.sendMessage({ channel: STATS_CHANNEL, ...command })) as
    | { ok: true; snapshot: ReadingStatsSnapshot }
    | { ok: false; error: string }
    | undefined;
  if (!reply?.ok)
    throw new Error(reply?.error || '통계에 연결하지 못했습니다. 다시 시도해 주세요.');
  return reply.snapshot;
};

export class ReadingStatsClient {
  private snapshot = { ...emptyStats };
  private listeners = new Set<() => void>();
  private stop = () => {};
  private initialized = false;
  private disposed = false;
  private revision = 0;
  private refreshQueued = false;

  constructor(
    private storage: StoragePort = chromeStorage(),
    private transport: StatsTransport = send
  ) {}

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish(snapshot: ReadingStatsSnapshot) {
    if (this.disposed) return;
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener());
  }

  private async request(command: ReadingStatsCommand) {
    const revision = ++this.revision;
    try {
      const snapshot = await this.transport(command);
      if (revision === this.revision) this.publish(snapshot);
      return snapshot;
    } catch (cause) {
      const snapshot = {
        ...this.snapshot,
        ready: true,
        error: cause instanceof Error ? cause.message : '통계를 불러오지 못했습니다.',
      };
      if (revision === this.revision) this.publish(snapshot);
      return snapshot;
    }
  }

  async initialize() {
    if (!this.initialized) {
      this.initialized = true;
      this.stop = this.storage.listen((changes, area) => {
        if (
          area !== 'local' ||
          !Object.values(STATS_KEYS).some((key) => key in changes) ||
          this.refreshQueued
        )
          return;
        this.refreshQueued = true;
        queueMicrotask(() => {
          this.refreshQueued = false;
          if (!this.disposed) void this.request({ action: 'read' });
        });
      });
    }
    return this.request({ action: 'read' });
  }

  setEnabled = (enabled: boolean) => this.request({ action: 'set-enabled', enabled });
  reset = () => this.request({ action: 'reset' });
  retry = () => this.request({ action: 'retry' });
  report = (report: ReadingStatsReport) => this.request({ action: 'report', report });

  dispose() {
    this.disposed = true;
    this.revision++;
    this.stop();
    this.listeners.clear();
  }
}
