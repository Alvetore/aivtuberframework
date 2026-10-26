import WebSocket from 'ws';
import type { ChatMessage, Settings } from '../shared/types.js';
import type { EventBus } from './event-bus.js';

const BASE_RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 30_000;

export function unescapeTag(value: string): string {
  return value.replace(/\\([:s\\rn])/g, (_, char) => {
    switch (char) {
      case ':': return ';';
      case 's': return ' ';
      case '\\': return '\\';
      case 'r': return '\r';
      case 'n': return '\n';
      default: return char;
    }
  });
}

export function parseTags(raw: string): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const pair of raw.split(';')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const key = eq === -1 ? pair : pair.slice(0, eq);
    const value = eq === -1 ? '' : pair.slice(eq + 1);
    tags[key] = unescapeTag(value);
  }
  return tags;
}

/** Minimal Twitch IRC client. It intentionally only receives messages; the bot never writes to chat. */
export class TwitchConnector {
  private socket?: WebSocket;
  private connected = false;
  private manualDisconnect = false;
  private reconnectAttempts = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private pingTimer?: NodeJS.Timeout;
  private joinTimer?: NodeJS.Timeout;
  private currentSettings?: Settings;

  constructor(private bus: EventBus) {}

  get isConnected() { return this.connected; }

  connect(settings: Settings) {
    this.disconnect();
    this.currentSettings = settings;
    this.manualDisconnect = false;
    this.reconnectAttempts = 0;
    this.openSocket();
  }

  disconnect() {
    this.manualDisconnect = true;
    this.stopKeepAlive();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    if (this.socket) {
      this.socket.close();
      this.socket = undefined;
    }
    this.setConnected(false);
  }

  private startKeepAlive() {
    this.stopKeepAlive();
    this.pingTimer = setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        try { this.socket.send('PING :tmi.twitch.tv'); } catch { /* ignore */ }
      }
    }, 60_000);
  }

  private stopKeepAlive() {
    if (this.joinTimer) { clearTimeout(this.joinTimer); this.joinTimer = undefined; }
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = undefined;
    }
  }

  private setConnected(value: boolean) {
    if (this.connected === value) return;
    this.connected = value;
    this.bus.emit(value ? 'TWITCH_CONNECTED' : 'TWITCH_DISCONNECTED', undefined);
  }

  private joined() {
    if (this.manualDisconnect || this.connected) return;
    if (this.joinTimer) { clearTimeout(this.joinTimer); this.joinTimer = undefined; }
    this.reconnectAttempts = 0;
    this.setConnected(true);
    this.bus.emit('LOG', { level: 'info', source: 'Twitch', message: `Подключено к #${this.currentSettings?.twitchChannel.replace(/^#/, '')}` });
  }

  private openSocket() {
    const settings = this.currentSettings;
    if (!settings) return;
    if (!settings.twitchUsername || !settings.twitchChannel || !settings.twitchOauthToken) {
      this.bus.emit('LOG', { level: 'error', source: 'Twitch', message: 'Заполните логин, канал и OAuth token Twitch.' });
      return;
    }
    this.stopKeepAlive();
    this.setConnected(false);
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.close();
      this.socket = undefined;
    }
    try {
      this.socket = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
    } catch (e) {
      this.bus.emit('LOG', { level: 'error', source: 'Twitch', message: e instanceof Error ? e.message : String(e) });
      this.scheduleReconnect();
      return;
    }
    const socket = this.socket;
    socket.on('open', () => {
      if (this.socket !== socket || this.manualDisconnect) return;
      this.startKeepAlive();
      socket.send('CAP REQ :twitch.tv/tags twitch.tv/commands twitch.tv/membership');
      socket.send(`PASS ${this.normalizeOauth(settings.twitchOauthToken)}`);
      socket.send(`NICK ${settings.twitchUsername}`);
      socket.send(`JOIN #${settings.twitchChannel.replace(/^#/, '')}`);
      this.bus.emit('LOG', { level: 'info', source: 'Twitch', message: 'Соединение открыто, ожидаю подтверждение входа в канал…' });
      this.joinTimer = setTimeout(() => {
        if (this.socket !== socket || this.connected) return;
        this.bus.emit('LOG', { level: 'error', source: 'Twitch', message: 'Twitch не подтвердил вход в канал. Повторное подключение…' });
        socket.close();
      }, 15_000);
    });
    socket.on('message', (raw) => { if (this.socket === socket) this.parse(raw.toString()); });
    socket.on('close', () => {
      if (this.socket !== socket) return;
      this.stopKeepAlive();
      this.setConnected(false);
      if (this.manualDisconnect) {
        this.bus.emit('LOG', { level: 'info', source: 'Twitch', message: 'Отключено.' });
      } else {
        this.bus.emit('LOG', { level: 'error', source: 'Twitch', message: 'Соединение разорвано, переподключение…' });
        this.scheduleReconnect();
      }
    });
    socket.on('error', (e) => {
      if (this.socket !== socket) return;
      this.bus.emit('LOG', { level: 'error', source: 'Twitch', message: e.message || 'WebSocket error' });
    });
  }

  private scheduleReconnect() {
    if (this.manualDisconnect || this.reconnectTimer) return;
    const delay = Math.min(MAX_RECONNECT_MS, BASE_RECONNECT_MS * 2 ** this.reconnectAttempts);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.openSocket();
    }, delay);
    this.bus.emit('LOG', { level: 'info', source: 'Twitch', message: `Повторное подключение через ${Math.round(delay / 1000)}s (попытка ${this.reconnectAttempts})` });
  }

  private normalizeOauth(token: string): string {
    return token.startsWith('oauth:') ? token : `oauth:${token}`;
  }

  private parse(line: string) {
    for (const item of line.split('\r\n')) {
      if (!item) continue;
      if (item.startsWith('PING')) {
        this.socket?.send(item.replace('PING', 'PONG'));
        continue;
      }
      const username = this.currentSettings?.twitchUsername.toLowerCase();
      const channel = this.currentSettings?.twitchChannel.replace(/^#/, '').toLowerCase();
      const ownJoin = item.match(/^(?:@[^ ]+ )?:([^! ]+)![^ ]+ JOIN #([^ ]+)$/);
      const endNames = item.match(/^(?:@[^ ]+ )?:tmi\.twitch\.tv 366 ([^ ]+) #([^ ]+) :/);
      if ((ownJoin && ownJoin[1].toLowerCase() === username && ownJoin[2].toLowerCase() === channel) || (endNames && endNames[1].toLowerCase() === username && endNames[2].toLowerCase() === channel)) {
        this.joined();
        continue;
      }
      const ownPart = item.match(/^(?:@[^ ]+ )?:([^! ]+)![^ ]+ PART #([^ ]+)/);
      if (ownPart && ownPart[1].toLowerCase() === username && ownPart[2].toLowerCase() === channel) {
        this.setConnected(false);this.socket?.close();continue;
      }
      const noticeMatch = item.match(/^(?:@([^ ]+) )?:tmi\.twitch\.tv NOTICE ([^ ]+) :?(.+)$/);
      if (noticeMatch) {
        const tags = noticeMatch[1] ? parseTags(noticeMatch[1]) : {};
        const msgId = tags['msg-id'] ?? '';
        const text = noticeMatch[3];
        const rejected = msgId === 'msg_bad_auth_token' || msgId === 'msg_login_failed' || /login authentication failed|improperly formatted auth|invalid nick|login unsuccessful/i.test(text);
        const banned = msgId.includes('ban') && noticeMatch[2].replace(/^#/, '').toLowerCase() === channel;
        const level = rejected || banned ? 'error' : 'info';
        this.bus.emit('LOG', { level, source: 'Twitch.Notice', message: `${msgId || 'notice'}: ${text}` });
        if (rejected || banned) { this.disconnect(); }
        continue;
      }
      const match = item.match(/^(?:@([^ ]+) )?:([^!]+)![^ ]+ PRIVMSG #([^ ]+) :(.+)$/);
      if (!match) continue;
      if (channel && match[3].toLowerCase() !== channel) continue;
      const tags = match[1] ? parseTags(match[1]) : {};
      const displayName = tags['display-name'] || match[2];
      const event: ChatMessage = {
        id: tags.id || crypto.randomUUID(),
        twitchId: tags['user-id'] || match[2],
        username: displayName,
        message: match[4],
        timestamp: new Date().toISOString(),
        badges: tags.badges ? tags.badges.split(',').filter(Boolean) : [],
      };
      this.bus.emit('CHAT_MESSAGE', event);
    }
  }
}
