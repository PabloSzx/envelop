/* eslint-disable no-console */

import { createServer } from 'http';

import { buildApp } from './app';

const server = createServer((req, res) => {
  app(req, res);
});

const app = buildApp({
  async prepare() {
    await import('./modules');
  },
});

server.listen(3000, () => {
  console.log('Listening on port 3000!');
});
