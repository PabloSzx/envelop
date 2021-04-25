import { BuildContextArgs, CreateApp, gql, InferFunctionReturn } from '@pablosz/envelop-app/fastify';

function buildContext({ request }: BuildContextArgs) {
  return {
    request,
    foo: 'bar',
  };
}

declare module '@pablosz/envelop-app/fastify' {
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
  websocketSubscriptions: {
    graphQLWS: true,
    subscriptionsTransport: true,
    buildSubscriptionsContext({ request }) {
      return {
        request,
        foo: 'baz',
      };
    },
  },
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
