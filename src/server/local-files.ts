import { realpath, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';

const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.moc3': 'application/octet-stream',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
  '.aac': 'audio/aac', '.flac': 'audio/flac',
};

export async function containedFile(root: string, relative: string): Promise<string | null> {
  const base = await realpath(root);
  const file = await realpath(path.resolve(base, relative));
  const rel = path.relative(base, file);
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
  return (await stat(file)).isFile() ? file : null;
}

export function isModelConfigPath(file: string): boolean {
  const name = path.basename(file).toLowerCase();
  return name.endsWith('.model3.json') || name === 'model.json';
}

async function sendFile(reply: FastifyReply, root: string, relative: string, modelOnly = false) {
  try {
    const file = await containedFile(root, relative);
    if (!file) return reply.code(403).send('Forbidden');
    const extension = path.extname(file).toLowerCase();
    if (modelOnly && !['.json', '.png', '.jpg', '.jpeg', '.webp', '.moc3', '.wav', '.mp3', '.ogg', '.m4a', '.aac', '.flac'].includes(extension)) return reply.code(403).send('Forbidden');
    reply.header('Content-Type', mime[extension] ?? 'application/octet-stream');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'no-store');
    return reply.send(createReadStream(file));
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return reply.code(404).send('Not found');
    throw error;
  }
}

export function registerLocalFiles(app: FastifyInstance, rendererRoot: string | undefined, getModelPath: () => string | undefined) {
  if (rendererRoot) {
    app.get('/', (_request, reply) => sendFile(reply, rendererRoot, 'index.html'));
    app.get('/assets/*', (request, reply) => sendFile(reply, rendererRoot, `assets/${(request.params as { '*': string })['*']}`));
    app.get('/live2dcubismcore.min.js', (_request, reply) => sendFile(reply, rendererRoot, 'live2dcubismcore.min.js'));
  }
  app.get('/api/avatar/model/*', async (request, reply) => {
    const modelPath = getModelPath();
    if (!modelPath || !isModelConfigPath(modelPath)) return reply.code(404).send('No Live2D model configured');
    const resolved = path.resolve(modelPath);
    // A config file at a drive root would turn the asset route into a
    // read primitive for every allowed file on that drive.
    if (path.dirname(resolved) === path.parse(resolved).root) return reply.code(403).send('Forbidden');
    try {
      if (!(await stat(resolved)).isFile()) return reply.code(404).send('No Live2D model configured');
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return reply.code(404).send('No Live2D model configured');
      throw error;
    }
    return sendFile(reply, path.dirname(resolved), (request.params as { '*': string })['*'] || path.basename(resolved), true);
  });
}
