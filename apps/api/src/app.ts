import Fastify from 'fastify';

export async function buildApp() {
  const app = Fastify({ logger: false });
  app.get('/api/health', async () => ({ ok: true }));
  return app;
}
