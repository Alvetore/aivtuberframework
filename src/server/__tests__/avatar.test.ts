import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

type MockSocket = EventEmitter & {
  readyState: number;
  sent: Array<{ requestID: string; messageType: string; data?: Record<string, unknown> }>;
  respond: ((msg: { messageType: string }) => Record<string, unknown> | undefined) | null;
  close: () => void;
};
const socketState = vi.hoisted(() => ({ instances: [] as MockSocket[] }));

vi.mock('ws', () => ({
  default: class extends EventEmitter {
    static OPEN = 1;
    readyState = 0;
    sent: MockSocket['sent'] = [];
    respond: MockSocket['respond'] = null;
    constructor() { super(); socketState.instances.push(this as unknown as MockSocket); }
    send(raw: string) {
      const msg = JSON.parse(raw);
      this.sent.push(msg);
      const reply = this.respond?.(msg);
      if (reply) queueMicrotask(() => this.emit('message', Buffer.from(JSON.stringify({ requestID: msg.requestID, ...reply }))));
    }
    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.emit('close');
    }
  },
}));

import { VTubeStudioProvider } from '../avatar.js';
import { EventBus } from '../event-bus.js';

afterEach(() => {
  for (const socket of socketState.instances) socket.removeAllListeners();
  socketState.instances = [];
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('VTube Studio connection lifecycle', () => {
  it('reconnects after a silent connection timeout', async () => {
    vi.useFakeTimers();
    const provider = new VTubeStudioProvider('ws://127.0.0.1:8001', new EventBus());
    const pending = provider.connect();
    await vi.advanceTimersByTimeAsync(4000);
    await pending;
    expect(socketState.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(6000);
    expect(socketState.instances).toHaveLength(2);
    provider.disconnect();
  });

  it('coalesces concurrent connect attempts into one socket', async () => {
    vi.useFakeTimers();
    const provider = new VTubeStudioProvider('ws://127.0.0.1:8001', new EventBus());
    const first = provider.connect();
    const second = provider.connect();
    expect(socketState.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(4000);
    await Promise.all([first, second]);
    provider.disconnect();
  });

  it('resumes reconnecting after a handshake failure before the token stage', async () => {
    vi.useFakeTimers();
    const provider = new VTubeStudioProvider('ws://127.0.0.1:8001', new EventBus());
    const pending = provider.connect();
    const socket = socketState.instances.at(-1)!;
    socket.readyState = 1;
    socket.respond = (msg) => msg.messageType === 'APIStateRequest'
      ? { messageType: 'APIStateResponse', data: { active: false } }
      : undefined;
    socket.emit('open');
    await pending;
    expect(socketState.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(6000);
    expect(socketState.instances).toHaveLength(2);
    provider.disconnect();
  });

  it('does not auto-retry after an explicit VTS auth rejection', async () => {
    vi.useFakeTimers();
    const storage = { getToken: () => '', setToken: async () => {} };
    const provider = new VTubeStudioProvider('ws://127.0.0.1:8001', new EventBus(), storage);
    const pending = provider.connect();
    const socket = socketState.instances.at(-1)!;
    socket.readyState = 1;
    socket.respond = (msg) => {
      if (msg.messageType === 'APIStateRequest') return { messageType: 'APIStateResponse', data: { active: true } };
      if (msg.messageType === 'AuthenticationTokenRequest') return { messageType: 'AuthenticationTokenResponse', data: { authenticationToken: 'tok' } };
      if (msg.messageType === 'AuthenticationRequest') return { messageType: 'AuthenticationResponse', data: { authenticated: false, reason: 'denied' } };
      return undefined;
    };
    socket.emit('open');
    await pending;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(socketState.instances).toHaveLength(1);
    provider.disconnect();
  });
});
