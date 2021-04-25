import { BuildContextArgs, CreateApp, gql, InferFunctionReturn } from '@envelop/app/fastify';

function buildContext({ request }: BuildContextArgs) {
  return {
    request,
    foo: 'bar',
  };
}

declare module '@envelop/app/fastify' {
  interface EnvelopContext extends InferFunctionReturn<typeof buildContext> {}
}

export const { registerModule, buildApp } = CreateApp({
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
    documents: 'src/graphql/*',
  },
  outputSchema: './schema.gql',
  scalars: {
    DateTime: 1,
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
  schema: {
    typeDefs: gql`
      type Query {
        hello3: String!
      }
    `,
    resolvers: {
      Query: {
        hello3(_root, _args, _ctx) {
          return 'zzz';
        },
      },
    },
  },
});

export { gql };
