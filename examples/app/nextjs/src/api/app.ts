import { CreateApp } from '@envelop/app/nextjs';

export const { buildApp, registerModule, gql } = CreateApp({
  buildContext() {
    return {
      foo: 'bar',
    };
  },
  codegen: {
    preImportCode: `
    /* eslint-disable no-use-before-define */
    `,
  },
});
