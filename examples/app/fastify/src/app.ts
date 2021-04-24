import { CreateApp, BuildContextArgs, InferFunctionReturn } from '@envelop/app/fastify';

function buildContext({ request }: BuildContextArgs) {
  return {
    request,
    foo: 'bar',
  };
}

declare module '@envelop/app/fastify' {
  interface FastifyEnvelopContext extends InferFunctionReturn<typeof buildContext> {}
}

export const { registerModule, buildApp, gql } = CreateApp({
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
  buildWebsocketSubscriptionsContext({ request }) {
    return {
      request,
      foo: 'baz',
    };
  },
  websocketSubscriptions: 'all',
  ide: {
    altair: true,
    graphiql: true,
  },
  routeOptions: {
    logLevel: 'info',
  },
});
