/* eslint-disable no-console */

import Koa from 'koa';
import KoaRouter from '@koa/router';

import { buildApp } from './app';

const app = new Koa();

const router = new KoaRouter();

buildApp({
  async prepare() {
    await import('./modules');
  },
  router,
}).then(() => {
  app.use(router.routes()).use(router.allowedMethods());

  app.listen(3000, () => {
    console.log('Listening on port 3000!');
  });
});
