import Fastify from 'fastify';

import { buildApp } from './app';

const fastifyApp = Fastify({
  logger: true,
});

buildApp(async () => {
  await import('./modules');
}).then(({ EnvelopAppPlugin }) => {
  fastifyApp.register(EnvelopAppPlugin);

  fastifyApp.listen(3000);
});
