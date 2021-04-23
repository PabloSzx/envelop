import Fastify from 'fastify';

import { buildApp } from './app';

const fastifyApp = Fastify({
  logger: true,
});

buildApp(async () => {
  await import('./modules');
}).then(({ EnvelopApp }) => {
  fastifyApp.register(EnvelopApp);

  fastifyApp.listen(3000);
});
