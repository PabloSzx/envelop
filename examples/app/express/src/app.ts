import { CreateExpressApp, ExpressContextArgs, InferFunctionReturn } from '@envelop/app';

function buildContext({ request }: ExpressContextArgs) {
  return {
    request,
    foo: 'bar',
  };
}

declare module '@envelop/app' {
  interface ExpressEnvelopContext extends InferFunctionReturn<typeof buildContext> {}
}

export const { registerModule, buildApp, gql } = CreateExpressApp({
  codegen: {
    federation: true,
    deepPartialResolvers: true,
    targetPath: './src/envelop.generated.ts',
    preImportCode: `
    /* eslint-disable no-use-before-define */
    `,
    scalars: {
      DateTime: 'string',
    },
  },
  outputSchema: './schema.gql',
  scalars: {
    DateTime: true,
  },
  buildContext,
  subscriptions: 'all',
  ide: {
    altair: true,
    graphiql: true,
  },
});
