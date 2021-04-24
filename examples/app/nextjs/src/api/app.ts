import { CreateNextjsApp } from '@envelop/app/nextjs';

export const { buildApp, registerModule, gql } = CreateNextjsApp({
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
