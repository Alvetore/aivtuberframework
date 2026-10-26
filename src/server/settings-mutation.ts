import type { FastifyInstance } from 'fastify';

/** Check after parsing, then continue synchronously into the route handler. */
export function registerSettingsMutationGuard(app: FastifyInstance, isSaving: () => boolean) {
  app.addHook('preHandler', (request, _reply, done) => {
    const path = request.url.split('?')[0];
    if (isSaving() && request.method !== 'GET' && !/^\/api\/runtime\/(stop|pause|interrupt|mute|unmute)$/.test(path)) {
      done(Object.assign(new Error('Настройки применяются. Дождитесь завершения.'), { statusCode: 409 }));
      return;
    }
    done();
  });
}
