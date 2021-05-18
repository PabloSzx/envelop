import {
  BuildContextArgs,
  CreateApp,
  gql,
  InferDataLoader,
  InferFunctionReturn,
  readStreamToBuffer,
} from '@pablosz/envelop-app/fastify';

function buildContext({ request }: BuildContextArgs) {
  return {
    request,
    foo: 'bar',
  };
}

export const { registerModule, buildApp, registerDataLoader, modules, plugins } = CreateApp({
  allowBatchedQueries: true,
  GraphQLUpload: true,
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
    graphiql: {
      subscriptionsEndpoint: 'http://localhost:3000/graphql',
    },
  },
  routeOptions: {
    logLevel: 'info',
  },
  schema: {
    typeDefs: gql`
      type Query {
        hello3: String!
      }
      type Mutation {
        uploadFileToBase64(file: Upload!): String!
      }
    `,
    resolvers: {
      Query: {
        hello3(_root, _args, ctx) {
          return ctx.stringRepeater.load('123');
        },
      },
      Mutation: {
        async uploadFileToBase64(_root, { file }) {
          const fileBuffer = await readStreamToBuffer(file);

          return Buffer.from(fileBuffer).toString('base64');
        },
      },
    },
  },
  jit: true,
});

const stringRepeatear = registerDataLoader('stringRepeater', DataLoader => {
  return new DataLoader(async (keys: readonly string[]) => {
    return keys.map(v => v.repeat(5));
  });
});
declare module '@pablosz/envelop-app/fastify' {
  interface EnvelopContext extends InferFunctionReturn<typeof buildContext>, InferDataLoader<typeof stringRepeatear> {}
}

export { gql };
