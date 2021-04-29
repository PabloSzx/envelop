import { buildApp } from '../../src/api/app';

const EnvelopApp = buildApp({
  async prepare() {
    await import('../../src/api/modules');
  },
});

export default EnvelopApp.handler;
