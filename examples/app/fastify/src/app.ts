import { CreateFastifyApp, FastifyContextArgs, InferFunctionReturn } from '@envelop/app';

function buildContext({ request }: FastifyContextArgs) {
  return {
    request,
    foo: 'bar',
  };
}

declare module '@envelop/app' {
  interface FastifyEnvelopContext extends InferFunctionReturn<typeof buildContext> {}
}

export const { registerModule, buildApp, gql } = CreateFastifyApp({
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
  buildSubscriptionsContext({ request }) {
    return {
      request,
      foo: 'baz',
    };
  },
  subscriptions: 'all',
});
