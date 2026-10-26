import WebSocket from 'ws';
import type { EventBus } from './event-bus.js';

export interface AvatarProvider {
  connect(): Promise<void>;
  disconnect(): void;
  setLipSync(value: number): void;
  setIdle(enabled: boolean): void;
  readonly isConnected: boolean;
}

export class DisabledAvatarProvider implements AvatarProvider {
  get isConnected() { return false; }
  async connect() {}
  disconnect() {}
  setLipSync() {}
  setIdle() {}
}

export interface VtsAuthStorage {
  getToken(): string;
  setToken(token: string): void;
}

export class VTubeStudioProvider implements AvatarProvider {
  private socket?: WebSocket;
  private connected = false;
  private authenticated = false;
  private reconnectTimer?: NodeJS.Timeout;
  private intentionalClose = false;
  private pendingRequests = new Map<string, (resp: any) => void>();

  constructor(
    private url: string,
    private bus: EventBus,
    private storage?: VtsAuthStorage,
  ) {}

  get isConnected() {
    return this.connected && this.authenticated;
  }

  async connect(): Promise<void> {
    this.intentionalClose = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;

    return new Promise<void>((resolve) => {
      try {
        this.socket = new WebSocket(this.url);
      } catch (err) {
        this.bus.emit('LOG', { level: 'error', source: 'Avatar.VTS', message: `Ошибка создания сокета VTS: ${String(err)}` });
        this.scheduleReconnect();
        return resolve();
      }

      const openTimeout = setTimeout(() => {
        if (!this.connected) {
          this.disconnect();
          this.bus.emit('LOG', {
            level: 'error',
            source: 'Avatar.VTS',
            message: `Таймаут подключения к VTube Studio (${this.url}). Убедитесь, что VTS открыт и в настройках включен API на порту 8001.`,
          });
          this.scheduleReconnect();
          resolve();
        }
      }, 4000);

      this.socket.on('open', () => {
        clearTimeout(openTimeout);
        this.connected = true;
        this.bus.emit('LOG', { level: 'info', source: 'Avatar.VTS', message: 'WebSocket соединен с VTube Studio. Проверка авторизации...' });
        this.handshake()
          .then(resolve)
          .catch((err) => {
            this.bus.emit('LOG', { level: 'error', source: 'Avatar.VTS', message: `Ошибка авторизации VTS: ${String(err)}` });
            resolve();
          });
      });

      this.socket.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          this.onMessage(msg);
        } catch {
          // ignore
        }
      });

      this.socket.on('close', () => {
        clearTimeout(openTimeout);
        const wasConn = this.connected;
        this.connected = false;
        this.authenticated = false;
        if (wasConn) {
          this.bus.emit('AVATAR_DISCONNECTED', undefined);
          this.bus.emit('LOG', { level: 'info', source: 'Avatar.VTS', message: 'Соединение с VTube Studio разорвано.' });
        }
        if (!this.intentionalClose) {
          this.scheduleReconnect();
        }
      });

      this.socket.on('error', (err) => {
        this.bus.emit('LOG', { level: 'error', source: 'Avatar.VTS', message: `VTS ошибка: ${err.message}` });
      });
    });
  }

  disconnect() {
    this.intentionalClose = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.close();
      this.socket = undefined;
    }
    this.connected = false;
    this.authenticated = false;
    this.bus.emit('AVATAR_DISCONNECTED', undefined);
  }

  private scheduleReconnect() {
    if (this.intentionalClose || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, 6000);
  }

  private request<T = any>(messageType: string, data?: object): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        return reject(new Error('VTS сокет не открыт'));
      }
      const requestID = crypto.randomUUID();
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestID);
        reject(new Error(`Таймаут запроса к VTS: ${messageType}`));
      }, 15000);

      this.pendingRequests.set(requestID, (resp) => {
        clearTimeout(timer);
        if (resp.messageType === 'APIError') {
          reject(new Error(`VTS API Error [${resp.data?.errorID}]: ${resp.data?.message}`));
        } else {
          resolve(resp.data);
        }
      });

      this.socket.send(JSON.stringify({
        apiName: 'VTubeStudioPublicAPI',
        apiVersion: '1.0',
        requestID,
        messageType,
        data: data ?? {},
      }));
    });
  }

  private onMessage(msg: { requestID?: string; messageType: string; data?: any }) {
    if (msg.requestID && this.pendingRequests.has(msg.requestID)) {
      const handler = this.pendingRequests.get(msg.requestID)!;
      this.pendingRequests.delete(msg.requestID);
      handler(msg);
    }
  }

  private async handshake(): Promise<void> {
    const state = await this.request('APIStateRequest');
    if (!state?.active) {
      throw new Error('VTS API не активен в настройках VTube Studio.');
    }

    let token = this.storage?.getToken() || '';
    if (!token) {
      this.bus.emit('LOG', {
        level: 'info',
        source: 'Avatar.VTS',
        message: 'Запрос доступа: перейдите в окно VTube Studio и нажмите [Разрешить / Allow]!',
      });
      const tokenResp = await this.request('AuthenticationTokenRequest', {
        pluginName: 'AI VTuber Framework Lite',
        pluginDeveloper: 'AIVTuberFramework',
      });
      token = tokenResp?.authenticationToken ?? '';
      if (!token) throw new Error('Токен авторизации не был получен.');
      this.storage?.setToken(token);
    }

    const authResp = await this.request('AuthenticationRequest', {
      pluginName: 'AI VTuber Framework Lite',
      pluginDeveloper: 'AIVTuberFramework',
      authenticationToken: token,
    });

    if (authResp?.authenticated) {
      this.authenticated = true;
      this.bus.emit('AVATAR_CONNECTED', undefined);
      this.bus.emit('LOG', {
        level: 'info',
        source: 'Avatar.VTS',
        message: '✓ VTube Studio успешно подключена и авторизована! LipSync активен.',
      });
    } else {
      this.storage?.setToken('');
      throw new Error(`Авторизация отклонена: ${authResp?.reason ?? 'токен отозван'}`);
    }
  }

  setLipSync(value: number) {
    if (!this.isConnected) return;
    const clamped = Math.max(0, Math.min(1, value));
    this.sendSilent('InjectParameterDataRequest', {
      parameterValues: [
        { id: 'MouthOpen', value: clamped, weight: 1.0 },
      ],
    });
  }

  setIdle(_enabled: boolean) {}

  private sendSilent(messageType: string, data: object) {
    if (this.socket?.readyState === WebSocket.OPEN && this.authenticated) {
      try {
        this.socket.send(JSON.stringify({
          apiName: 'VTubeStudioPublicAPI',
          apiVersion: '1.0',
          requestID: crypto.randomUUID(),
          messageType,
          data,
        }));
      } catch {
        // ignore
      }
    }
  }
}
