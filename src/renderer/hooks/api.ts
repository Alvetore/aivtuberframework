const BASE = '';
export const websocketUrl = () => `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;

export class ApiError extends Error {
  constructor(public status: number, public body: string, message: string) { super(message); }
}

export async function api<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const controller = new AbortController();
  const timer = init?.timeoutMs ? setTimeout(() => controller.abort(), init.timeoutMs) : null;
  try {
    const headers: Record<string, string> = {};
    if (init?.body) {
      headers['Content-Type'] = 'application/json';
    }
    if (init?.headers) {
      Object.assign(headers, init.headers);
    }
    const response = await fetch(`${BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers,
    });
    if (!response.ok) {
      const text = await response.text();
      let message=text;try{const body=JSON.parse(text);message=body.error??body.message??text;}catch{}
      throw new ApiError(response.status, text, String(message).slice(0,300));
    }
    return await response.json() as T;
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw new ApiError(0, '', 'Таймаут запроса');
    throw e;
  } finally { if (timer) clearTimeout(timer); }
}

export type Sender = (msg: { type: string; payload: unknown }) => void;
