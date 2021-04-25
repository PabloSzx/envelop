import Fastify from 'fastify';

import { buildApp } from './app';

const fastifyApp = Fastify({
  logger: true,
});

buildApp({
  async prepare() {
    await import('./modules');
  },
}).then(EnvelopApp => {
  fastifyApp.register(EnvelopApp, {
    logLevel: 'error',
  });

  fastifyApp.listen(3000);
});
