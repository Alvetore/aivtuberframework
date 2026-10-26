import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/server/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: { url: process.env.DB_PATH ?? 'data/vtuber.sqlite' },
  strict: true,
  verbose: true,
});
