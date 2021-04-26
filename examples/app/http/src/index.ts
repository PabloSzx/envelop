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

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Listening on port ${port}!`);
});
