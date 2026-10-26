import { useEffect, useRef, useState } from 'react';

export interface UseWebSocketOptions {
  url: string;
  onMessage: (msg: { type: string; payload: unknown }) => void;
  onStatus?: (state: 'connecting' | 'open' | 'closed') => void;
  enabled?: boolean;
}

export function useWebSocket({ url, onMessage, onStatus, enabled = true }: UseWebSocketOptions) {
  const [state, setState] = useState<'connecting' | 'open' | 'closed'>('connecting');
  const ref = useRef<{ socket: WebSocket | null; intentional: boolean; timer: number | null }>({ socket: null, intentional: false, timer: null });
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const onStatusRef=useRef(onStatus);onStatusRef.current=onStatus;

  useEffect(() => {
    if (!enabled) return;
    const r = ref.current;
    r.intentional = false;
    const connect = () => {
      if (r.intentional) return;
      setState('connecting');
      onStatusRef.current?.('connecting');
      const ws = new WebSocket(url);
      r.socket = ws;
      ws.onopen = () => { setState('open'); onStatusRef.current?.('open'); };
      ws.onmessage = (event) => {
        if(r.socket!==ws||r.intentional)return;
        try { onMessageRef.current(JSON.parse(event.data)); }
        catch { /* ignore malformed */ }
      };
      ws.onclose = () => {
        if (r.socket !== ws) return;
        setState('closed');
        onStatusRef.current?.('closed');
        if (!r.intentional) r.timer = window.setTimeout(connect, 2000);
      };
      ws.onerror = () => { ws.close(); };
    };
    connect();
    return () => {
      r.intentional = true;
      if (r.timer) { clearTimeout(r.timer); r.timer = null; }
      r.socket?.close();
      r.socket = null;
    };
  }, [url, enabled]);

  const send = (msg: { type: string; payload: unknown }) => {
    const ws = ref.current.socket;
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  };

  return { state, send };
}
