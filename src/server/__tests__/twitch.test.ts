import { afterEach, describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
const socketState=vi.hoisted(()=>({instances:[] as any[]}));
vi.mock('ws',()=>({default:class extends EventEmitter {
  static OPEN=1;
  readyState=0;
  sent:string[]=[];
  constructor(_url:string){super();socketState.instances.push(this);}
  send(text:string){this.sent.push(text);}
  close(){if(this.readyState===3)return;this.readyState=3;this.emit('close');}
}}));
import { unescapeTag, parseTags, TwitchConnector } from '../twitch.js';
import { EventBus } from '../event-bus.js';
import { defaultSettings } from '../../shared/types.js';

function connectedFixture(){
  const bus=new EventBus();const connector=new TwitchConnector(bus);const connected=vi.fn();const disconnected=vi.fn();
  bus.on('TWITCH_CONNECTED',connected);bus.on('TWITCH_DISCONNECTED',disconnected);
  connector.connect({...defaultSettings,twitchUsername:'bot',twitchChannel:'#streamer',twitchOauthToken:'fixture-token'});
  const socket=socketState.instances.at(-1);socket.readyState=1;socket.emit('open');
  const message=(line:string)=>socket.emit('message',Buffer.from(line));
  return {connector,socket,message,connected,disconnected};
}
afterEach(()=>{for(const socket of socketState.instances)socket.removeAllListeners();socketState.instances=[];vi.clearAllTimers();vi.useRealTimers();});

describe('twitch IRC parser', () => {
  it('unescapes IRC tag special characters correctly', () => {
    expect(unescapeTag('Hello\\sWorld')).toBe('Hello World');
    expect(unescapeTag('Semi\\:colon')).toBe('Semi;colon');
    expect(unescapeTag('Back\\\\slash')).toBe('Back\\slash');
    expect(unescapeTag('Line\\nbreak')).toBe('Line\nbreak');
    expect(unescapeTag('Carriage\\rreturn')).toBe('Carriage\rreturn');
  });

  it('parses raw IRC tags string into key-value map', () => {
    const rawTags = 'badge-info=;badges=broadcaster/1;color=#FF69B4;display-name=Streamer\\sBoss;emotes=;id=123-abc';
    const tags = parseTags(rawTags);

    expect(tags['badges']).toBe('broadcaster/1');
    expect(tags['color']).toBe('#FF69B4');
    expect(tags['display-name']).toBe('Streamer Boss');
    expect(tags['id']).toBe('123-abc');
  });

  it('parses incoming IRC messages via event bus', () => {
    const bus = new EventBus();
    const connector = new TwitchConnector(bus);

    const received: any[] = [];
    bus.on('CHAT_MESSAGE', (msg) => {
      received.push(msg);
    });

    // Access private parse method for testing
    const parseMethod = (connector as any).parse.bind(connector);

    const ircPrivmsgWithTags = '@badge-info=;badges=subscriber/6;display-name=CoolViewer;id=msg-001;user-id=999 :coolviewer!coolviewer@coolviewer.tmi.twitch.tv PRIVMSG #streamer :Привет стример!';
    parseMethod(ircPrivmsgWithTags);

    expect(received.length).toBe(1);
    expect(received[0].username).toBe('CoolViewer');
    expect(received[0].message).toBe('Привет стример!');
    expect(received[0].twitchId).toBe('999');
    expect(received[0].id).toBe('msg-001');

    // PRIVMSG without tags
    parseMethod(':regular!regular@regular.tmi.twitch.tv PRIVMSG #streamer :Простое сообщение');
    expect(received.length).toBe(2);
    expect(received[1].username).toBe('regular');
    expect(received[1].message).toBe('Простое сообщение');
  });
});

describe('Twitch authenticated channel readiness',()=>{
  it('does not announce readiness at socket open, another user join, or another channel',()=>{
    vi.useFakeTimers();const t=connectedFixture();
    expect(t.connector.isConnected).toBe(false);expect(t.connected).not.toHaveBeenCalled();
    expect(t.socket.sent).toContain('JOIN #streamer');
    t.message(':viewer!viewer@viewer.tmi.twitch.tv JOIN #streamer');
    t.message(':bot!bot@bot.tmi.twitch.tv JOIN #other');
    t.message(':tmi.twitch.tv 366 other #streamer :End of /NAMES list');
    expect(t.connector.isConnected).toBe(false);
    t.message(':bot!bot@bot.tmi.twitch.tv JOIN #streamer');
    expect(t.connector.isConnected).toBe(true);expect(t.connected).toHaveBeenCalledOnce();
    t.message(':tmi.twitch.tv 366 bot #streamer :End of /NAMES list');
    expect(t.connected).toHaveBeenCalledOnce();t.connector.disconnect();expect(t.disconnected).toHaveBeenCalledOnce();
  });

  it('accepts the matching channel names-complete acknowledgement, case insensitively',()=>{
    vi.useFakeTimers();const t=connectedFixture();
    t.message(':tmi.twitch.tv 366 BOT #STREAMER :End of /NAMES list');
    expect(t.connector.isConnected).toBe(true);t.connector.disconnect();
  });

  it.each([':tmi.twitch.tv NOTICE * :Login authentication failed','@msg-id=msg_login_failed :tmi.twitch.tv NOTICE #streamer :Login unsuccessful'])('clears readiness on authentication rejection without silently retrying bad credentials: %s',line=>{
    vi.useFakeTimers();const t=connectedFixture();
    t.message(':bot!bot@bot.tmi.twitch.tv JOIN #streamer');
    t.message(line);
    expect(t.connector.isConnected).toBe(false);expect(t.disconnected).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(120_000);expect(socketState.instances).toHaveLength(1);
  });

  it('retries a connection whose channel join was never acknowledged',()=>{
    vi.useFakeTimers();const t=connectedFixture();
    vi.advanceTimersByTime(15_000);expect(t.connector.isConnected).toBe(false);
    vi.advanceTimersByTime(1_000);expect(socketState.instances).toHaveLength(2);
    expect(t.connected).not.toHaveBeenCalled();t.connector.disconnect();
  });

  it('pauses readiness when its channel is left and restores only after a new join',()=>{
    vi.useFakeTimers();const t=connectedFixture();t.message(':bot!bot@bot.tmi.twitch.tv JOIN #streamer');
    t.message(':bot!bot@bot.tmi.twitch.tv PART #streamer');
    expect(t.connector.isConnected).toBe(false);expect(t.disconnected).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1000);const socket=socketState.instances.at(-1);socket.readyState=1;socket.emit('open');
    expect(t.connector.isConnected).toBe(false);socket.emit('message',Buffer.from(':bot!bot@bot.tmi.twitch.tv JOIN #streamer'));
    expect(t.connector.isConnected).toBe(true);t.connector.disconnect();
  });

  it('manual disconnect cancels pending reconnection and a new invalid configuration cannot retain readiness',()=>{
    vi.useFakeTimers();const t=connectedFixture();t.message(':bot!bot@bot.tmi.twitch.tv JOIN #streamer');
    t.connector.connect({...defaultSettings,twitchUsername:'bot',twitchChannel:'streamer',twitchOauthToken:''});
    expect(t.connector.isConnected).toBe(false);vi.advanceTimersByTime(60_000);expect(socketState.instances).toHaveLength(1);
  });
});
