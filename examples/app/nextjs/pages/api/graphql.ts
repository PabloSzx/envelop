import { buildApp } from '../../src/api/app';

const app = buildApp({
  async prepare() {
    await import('../../src/api/modules');
  },
});

export default app;
