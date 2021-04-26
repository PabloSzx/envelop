import Fastify from 'fastify';

import { CreateEnvelopApp } from '@envelop/app';

const app = Fastify({
  logger: true,
});

const { registerModule, buildApp, gql } = CreateEnvelopApp({
  deepPartialResolvers: true,
  codegenConfig: {
    federation: true,
  },
  targetPath: './src/envelop.generated.ts',
  outputSchema: './schema.gql',
});

registerModule(
  gql`
    type Query {
      hello: String!
    }
  `,
  {
    resolvers: {
      Query: {
        hello() {
          return 'hello';
        },
      },
    },
  }
);

registerModule(
  gql`
    extend type Query {
      hello2: String!
    }
  `,
  {
    resolvers: {
      Query: {
        hello2() {
          return 'asd';
        },
      },
    },
  }
);

const { FastifyPlugin } = buildApp();

app.register(FastifyPlugin);

app.listen(3000);
