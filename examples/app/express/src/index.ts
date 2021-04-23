import express from 'express';

import { buildApp } from './app';

const app = express();

buildApp(async () => {
  await import('./modules');
}).then(({ EnvelopAppRouter }) => {
  app.use(EnvelopAppRouter);

  app.listen(3000, () => {
    console.log('listening on port 3000');
  });
});
