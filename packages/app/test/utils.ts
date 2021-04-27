/* eslint-disable no-console */

import getPort from 'get-port';
import fetch from 'undici-fetch';
import { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { ExecutionResult, print, stripIgnoredCharacters } from 'graphql';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { resolve, join } from 'path';
import { gql } from 'graphql-modules';

const TearDownCallbacks = Array<() => Promise<unknown>>();

const CodegenPromises = Array<Promise<void>>();

function Codegen() {
  const {
    EnvelopCodegen,
  } = require('../dist/cjs/common/codegen/typescript') as typeof import('../src/common/codegen/typescript');

  CodegenPromises.push(
    EnvelopCodegen(
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
          targetPath: resolve(__dirname, `./generated/envelop.generated.ts`),
          documents: join(__dirname, './graphql/*.gql'),
          transformGenerated(code) {
            return code.replace(/@pablosz\/envelop-app\/http/g, '../../src/common/types');
          },
        },
      },
      {
        moduleName: 'http',
      }
    ).catch(console.error)
  );
}

beforeAll(async () => {
  // Needed because of a ts-jest issue with .js extensions, see https://github.com/kulshekhar/ts-jest/issues/1057
  await require('tsc-node-build/src/main').build({
    project: resolve(__dirname, '../tsconfig.json'),
    skipEsm: true,
  });
  Codegen();
});

afterAll(async () => {
  await Promise.all([...Array.from(TearDownCallbacks).map(cb => cb()), fetch.close(), ...CodegenPromises]);
});

export async function startExpressServer({
  options,
  buildOptions,
}: {
  options?: import('../src/express').EnvelopAppOptions;
  buildOptions?: Partial<import('../src/express').BuildAppOptions>;
}): Promise<
  <TData, TVariables>(
    document: TypedDocumentNode<TData, TVariables>
  ) => Promise<
    ExecutionResult<
      TData,
      {
        [key: string]: any;
      }
    >
  >
> {
  const app = (await import('express')).default();

  const { CreateApp } = require('../dist/cjs/express') as typeof import('../src/express');

  const appBuilder = CreateApp(options);

  app.use(await appBuilder.buildApp({ app, ...buildOptions }));

  const port = await getPort();

  await new Promise<void>(resolve => {
    const server = app.listen(port, resolve);

    TearDownCallbacks.push(() => new Promise(resolve => server.close(resolve)));
  });

  return async function <TData, TVariables>(document: TypedDocumentNode<TData, TVariables>) {
    const Response = await fetch(`http://127.0.0.1:${port}/graphql?query=${stripIgnoredCharacters(print(document))}`);

    const result: ExecutionResult<TData> = await Response.json();

    return result;
  };
}
