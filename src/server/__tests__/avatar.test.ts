import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const socketState = vi.hoisted(() => ({ instances: [] as Array<EventEmitter & { readyState: number; close: () => void }> }));

vi.mock('ws', () => ({
  default: class extends EventEmitter {
    static OPEN = 1;
    readyState = 0;
    constructor() { super(); socketState.instances.push(this); }
    send() { /* no-op for lifecycle tests */ }
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
});
