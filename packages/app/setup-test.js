const { resolve, join } = require('path');
const { makeExecutableSchema } = require('@graphql-tools/schema');

module.exports = async () => {
  await require('tsc-node-build/src/main').build({
    project: resolve(__dirname, './tsconfig.json'),
    skipEsm: true,
    silent: true,
  });

  const { EnvelopCodegen, gql } = require('./dist/cjs/extend');

  await EnvelopCodegen(
    makeExecutableSchema({
      typeDefs: gql`
        type Query {
          hello: String!
        }
      `,
    }),
    {
      enableCodegen: true,
      codegen: {
        preImportCode: `/* eslint-disable no-use-before-define */`,
        targetPath: resolve(__dirname, `./test/generated/envelop.generated.ts`),
        documents: join(__dirname, './test/graphql/*.gql'),
        transformGenerated(code) {
          return code;
        },
      },
    },
    {
      moduleName: 'http',
    }
  );
};