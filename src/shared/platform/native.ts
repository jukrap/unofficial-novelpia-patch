import {
  NATIVE_CHANNEL,
  isNativeState,
  type NativeCommand,
  type NativeReply,
  type NativeState,
} from '@/shared/model/native-protocol';
export class NativeClient {
  private pending = new Map<
    string,
    {
      resolve: (state: NativeState) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor() {
    window.addEventListener('message', this.receive);
  }
  private receive = (event: MessageEvent) => {
    const value = event.data as NativeReply;
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      value?.channel !== NATIVE_CHANNEL ||
      value.direction !== 'reply' ||
      typeof value.id !== 'string'
    )
      return;
    const request = this.pending.get(value.id);
    if (!request) return;
    clearTimeout(request.timer);
    this.pending.delete(value.id);
    if (typeof value.error === 'string' || !isNativeState(value.state))
      request.reject(
        new Error(typeof value.error === 'string' ? value.error : '사이트 상태를 읽지 못했습니다.')
      );
    else request.resolve(value.state);
  };
  request(command: NativeCommand): Promise<NativeState> {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('사이트 연결을 확인해 주세요.'));
      }, 2500);
      this.pending.set(id, { resolve, reject, timer });
      window.postMessage(
        { channel: NATIVE_CHANNEL, direction: 'request', id, command },
        location.origin
      );
    });
  }
  dispose() {
    window.removeEventListener('message', this.receive);
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('연결을 종료했습니다.'));
    }
    this.pending.clear();
  }
}
