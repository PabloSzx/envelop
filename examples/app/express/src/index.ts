/* eslint-disable no-console */

import express from 'express';

import { buildApp } from './app';

const app = express();

buildApp({
  app,
  async prepare() {
    await import('./modules');
  },
}).then(({ EnvelopApp }) => {
  app.use(EnvelopApp);

  app.listen(3000, () => {
    console.log('Listening on port 3000!');
  });
});
