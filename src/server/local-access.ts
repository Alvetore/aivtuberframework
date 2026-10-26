import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

export function registerLocalAccess(app: FastifyInstance, token: string, devOrigin?: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Electron session token is required.');
  app.addHook('onRequest', async (request, reply) => {
    const expectedHost = `127.0.0.1:${(app.server.address() as { port?: number } | null)?.port ?? process.env.PORT ?? 3001}`;
    if (request.headers.host !== expectedHost) return reply.code(403).send({ error: 'Invalid host' });
    const origin = request.headers.origin;
    if (origin && origin !== `http://${expectedHost}` && origin !== devOrigin) return reply.code(403).send({ error: 'Invalid origin' });
    const cookie = request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('vtuber_session='));
    const supplied = cookie?.slice('vtuber_session='.length) ?? '';
    if (!/^[a-f0-9]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) return reply.code(401).send({ error: 'Unauthorized' });
  });
}
