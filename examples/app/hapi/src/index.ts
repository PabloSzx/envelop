/* eslint-disable no-console */

import Hapi from '@hapi/hapi';

import { buildApp } from './app';

async function init() {
  const port = process.env.PORT || 3000;
  const server = Hapi.server({
    port,
    host: 'localhost',
  });

  const app = buildApp({
    async prepare() {
      await import('./modules');
    },
  });

  await server.register(app);

  await server.start();

  console.log(`Hapi Listening on port ${port}!`);
}

init().catch(console.error);
