import Fastify from 'fastify';

import { buildApp } from './app';

const fastifyApp = Fastify({
  logger: true,
});

const EnvelopPlugin = buildApp({
  async prepare() {
    await import('./modules');
  },
});

fastifyApp.register(EnvelopPlugin, {
  logLevel: 'error',
});

fastifyApp.listen(process.env.PORT || 3000);
