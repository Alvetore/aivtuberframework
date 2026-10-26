import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDatabase } from './database';
import type { Settings } from '../shared/types';
import { ProfileFileSchema, type RuntimeState } from '../shared/product';

const NameSchema = z.object({ name: z.string().trim().min(1).max(64) }).strict();
const DuplicateSchema = z.object({ name: z.string().trim().min(1).max(64).optional() }).strict();
export function registerProfileRoutes(app: FastifyInstance, db: AppDatabase, context: {
  getRuntime: () => RuntimeState;
  beforeSelect: () => void;
  applySettings: (settings: Settings) => void;
  publish: (type: string, payload: unknown) => void;
}) {
  const changed = () => context.publish('profiles', db.listProfiles());
  app.get('/api/profiles', () => db.listProfiles());
  app.post('/api/profiles', async (request, reply) => {
    const parsed = NameSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Укажите имя профиля от 1 до 64 символов.' });
    const profile = db.createProfile(parsed.data.name);
    changed(); return profile;
  });
  app.post('/api/profiles/import', async (request, reply) => {
    const parsed = ProfileFileSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Неверный формат профиля или неподдерживаемая версия. Изменения не внесены.' });
    const profile = db.importProfile(parsed.data);
    changed(); return profile;
  });
  app.patch<{ Params: { id: string } }>('/api/profiles/:id', async (request, reply) => {
    const parsed = NameSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Укажите имя профиля от 1 до 64 символов.' });
    if (!db.listProfiles().some(profile => profile.id === request.params.id)) return reply.code(404).send({ error: 'Профиль не найден.' });
    const profile = db.updateProfile(request.params.id, parsed.data.name);
    changed(); return profile;
  });
  app.post<{ Params: { id: string } }>('/api/profiles/:id/duplicate', async (request, reply) => {
    const parsed = DuplicateSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Некорректное имя копии.' });
    if (!db.listProfiles().some(profile => profile.id === request.params.id)) return reply.code(404).send({ error: 'Профиль не найден.' });
    const profile = db.duplicateProfile(request.params.id, parsed.data.name);
    changed(); return profile;
  });
  app.get<{ Params: { id: string } }>('/api/profiles/:id/export', async (request, reply) => {
    if (!db.listProfiles().some(profile => profile.id === request.params.id)) return reply.code(404).send({ error: 'Профиль не найден.' });
    return ProfileFileSchema.parse(db.exportProfile(request.params.id));
  });
  app.post<{ Params: { id: string } }>('/api/profiles/:id/select', async (request, reply) => {
    if (context.getRuntime().state === 'running') return reply.code(409).send({ error: 'Поставьте ведущую на паузу перед сменой профиля.' });
    if (!db.listProfiles().some(profile => profile.id === request.params.id)) return reply.code(404).send({ error: 'Профиль не найден.' });
    if (request.params.id !== db.activeProfileId()) {
      context.beforeSelect();
      const selected = db.selectProfile(request.params.id);
      context.applySettings(selected);
    }
    const settings = db.getSettings();
    changed();
    // Settings contain no credentials; the primary integration publishes its masked DTO.
    return { settings, profiles: db.listProfiles() };
  });
}
