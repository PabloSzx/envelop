const { resolve } = require('path');
const { makeExecutableSchema } = require('@graphql-tools/schema');

module.exports = async () => {
  await require('tsc-node-build/src/main').build({
    project: resolve(__dirname, './tsconfig.json'),
    skipEsm: true,
    silent: true,
  });

  /**
   * @type {import("./src/extend")}
   */
  const { EnvelopCodegen, gql } = require('./dist/cjs/extend');

  await EnvelopCodegen(
    makeExecutableSchema({
      typeDefs: gql`
        type Query {
          hello: String!
          users: [User!]!
        }
        type User {
          id: Int!
        }
      `,
    }),
    {
      enableCodegen: true,
      codegen: {
        preImportCode: `/* eslint-disable no-use-before-define */`,
        targetPath: resolve(__dirname, `./test/generated/envelop.generated.ts`),
        documents: resolve(__dirname, './test/graphql/*.gql'),
        transformGenerated(code) {
          return code.replace(/@pablosz\/envelop-app\/extend/g, '../../src/common/types');
        },
      },
    },
    {
      moduleName: 'extend',
    }
  );
};
