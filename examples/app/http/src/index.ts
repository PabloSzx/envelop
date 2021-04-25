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
  // eslint-disable-next-line no-console
  console.log('Listening on port 3000!');
});
