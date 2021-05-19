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
          getContext: JSONObject!
          stream: [String!]!
        }
        type Mutation {
          uploadFileToBase64(file: Upload!): String!
        }
        type Subscription {
          ping: String!
        }
        type User {
          id: Int!
        }
        scalar JSONObject
        scalar Upload
      `,
    }),
    {
      enableCodegen: true,
      codegen: {
        preImportCode: `/* eslint-disable no-use-before-define */\n/* istanbul ignore file */\n\n`,
        targetPath: resolve(__dirname, `./test/generated/envelop.generated.ts`),
        documents: resolve(__dirname, './test/graphql/*.gql'),
        transformGenerated(code) {
          return code.replace(/@pablosz\/envelop-app\/extend/g, '../../src/common/types');
        },
        scalars: {
          Upload: "Promise<import('graphql-upload').FileUpload>",
        },
      },
    },
    {
      moduleName: 'extend',
    }
  );
};
