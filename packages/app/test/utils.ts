/* eslint-disable @typescript-eslint/explicit-module-boundary-types */

import tmp from 'tmp-promise';
import DataLoader from 'dataloader';
import getPort from 'get-port';
import { ExecutionResult, print } from 'graphql';
import { Readable } from 'stream';
import { Pool } from 'undici';
import { RequestOptions } from 'undici/types/client';
import merge from 'lodash/merge';

import {
  BaseEnvelopAppOptions,
  BaseEnvelopBuilder,
  CodegenConfig,
  createDeferredPromise,
  EnvelopContext,
  gql,
  InternalAppBuildOptions,
  LazyPromise,
  PLazy,
} from '@envelop/app/extend';

import type { TypedDocumentNode } from '@graphql-typed-document-node/core';

const TearDownPromises: Promise<unknown>[] = [];

afterAll(async () => {
  await Promise.all(TearDownPromises);
});

declare module '../src/extend' {
  interface EnvelopContext extends Record<'numberMultiplier', DataLoader<number, number>> {}
}

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function commonImplementation({ registerDataLoader, registerModule }: BaseEnvelopBuilder) {
  registerDataLoader('numberMultiplier', DataLoader => {
    return new DataLoader(async (keys: readonly number[]) => {
      return keys.map(k => k * 100);
    });
  });

  registerModule(
    gql`
      type Query {
        hello: String!
        users: [User!]!
        stream: [String!]!
      }
      type Subscription {
        ping: String!
      }
      type User {
        id: Int!
      }
    `,
    {
      resolvers: {
        Query: {
          hello(_root, _args, _ctx) {
            return 'Hello World!';
          },
          async users(_root, _args, _ctx) {
            return [...Array(10).keys()].map(id => ({
              id,
            }));
          },
          stream: {
            // @ts-expect-error codegen incompatibility with stream/defer directives
            resolve: async function* () {
              yield 'A';
              await sleep(100);
              yield 'B';
              await sleep(100);
              yield 'C';
            },
          },
        },
        User: {
          async id(root, _args, ctx) {
            return ctx.numberMultiplier.load(root.id);
          },
        },
        Subscription: {
          ping: {
            async *subscribe() {
              for (let i = 1; i <= 5; ++i) {
                await sleep(100);

                yield {
                  ping: 'pong',
                };
              }
            },
          },
        },
      },
    }
  );
}

export interface TestCodegenOptions {
  tmpSchemaExtension?: string;
  tmpTSGeneratedExtension?: string;
}

export async function Codegen(
  options: BaseEnvelopAppOptions<never>,
  { tmpSchemaExtension = '.gql', tmpTSGeneratedExtension = '.ts' }: TestCodegenOptions = {}
) {
  let tmpSchemaPath: string | undefined;
  let tmpPath: string | undefined;
  const deferredCodegenPromise = createDeferredPromise();

  if (options.enableCodegen) {
    await Promise.all([
      (async () => {
        const tmpSchema = await tmp.file({
          postfix: tmpSchemaExtension,
        });

        TearDownPromises.push(LazyPromise(() => tmpSchema.cleanup()));

        tmpSchemaPath = tmpSchema.path;

        merge(options, {
          outputSchema: tmpSchema.path,
          codegen: {
            onFinish: deferredCodegenPromise.resolve,
            onError: deferredCodegenPromise.reject,
          },
        } as typeof options);
      })(),
      (async () => {
        const tmpFile = await tmp.file({
          postfix: tmpTSGeneratedExtension,
        });
        TearDownPromises.push(LazyPromise(() => tmpFile.cleanup()));
        tmpPath = tmpFile.path;

        merge((options.codegen ||= {}), {
          targetPath: tmpFile.path,
        } as CodegenConfig);
      })(),
    ]);
  } else {
    deferredCodegenPromise.resolve();
  }

  return {
    tmpSchemaPath,
    tmpPath,
    codegenPromise: deferredCodegenPromise.promise,
  };
}

export interface StartTestServerOptions<
  Options extends BaseEnvelopAppOptions<EnvelopContext>,
  BuildOptions extends Pick<InternalAppBuildOptions<EnvelopContext>, 'prepare'>
> {
  options?: Options;
  buildOptions?: Partial<BuildOptions>;
  testCodegenOptions?: TestCodegenOptions;
}

export async function startExpressServer({
  options = {},
  buildOptions = {},
  testCodegenOptions,
}: StartTestServerOptions<import('../src/express').EnvelopAppOptions, import('../src/express').BuildAppOptions>) {
  const app = (await import('express')).default();

  const { CreateApp } = await import('../src/express');

  const { tmpPath, tmpSchemaPath, codegenPromise } = await Codegen(options, testCodegenOptions);

  app.use((await CreateApp(options).buildApp({ app, ...buildOptions })).router);

  const port = await getPort();

  await new Promise<void>(resolve => {
    const server = app.listen(port, resolve);

    TearDownPromises.push(new PLazy(resolve => server.close(resolve)));
  });

  return { ...getRequestPool(port), tmpPath, tmpSchemaPath, codegenPromise };
}

export async function startFastifyServer({
  options = {},
  buildOptions,
  testCodegenOptions,
}: StartTestServerOptions<import('../src/fastify').EnvelopAppOptions, import('../src/express').BuildAppOptions>) {
  const app = (await import('fastify')).default();

  const { CreateApp } = await import('../src/fastify');

  const { tmpPath, tmpSchemaPath, codegenPromise } = await Codegen(options, testCodegenOptions);

  app.register(CreateApp(options).buildApp(buildOptions).plugin);

  const port = await getPort();

  await new Promise((resolve, reject) => {
    app.listen(port).then(resolve, reject);

    TearDownPromises.push(
      new PLazy<void>(resolve => app.close(resolve))
    );
  });

  return { ...getRequestPool(port), tmpPath, tmpSchemaPath, codegenPromise };
}

export async function startHTTPServer({
  options = {},
  buildOptions,
  testCodegenOptions,
}: StartTestServerOptions<import('../src/http').EnvelopAppOptions, import('../src/http').BuildAppOptions>) {
  const { CreateApp } = await import('../src/http');

  const { tmpPath, tmpSchemaPath, codegenPromise } = await Codegen(options, testCodegenOptions);

  const app = CreateApp(options).buildApp(buildOptions);

  const server = (await import('http')).createServer((req, res) => {
    app.requestHandler(req, res);
  });

  const port = await getPort();

  await new Promise<void>(resolve => {
    server.listen(port, () => {
      resolve();
    });

    TearDownPromises.push(
      new PLazy<void>((resolve, reject) =>
        server.close(err => {
          if (err) return reject(err);
          resolve();
        })
      )
    );
  });

  return { ...getRequestPool(port), tmpPath, tmpSchemaPath, codegenPromise };
}

export async function startHapiServer({
  options = {},
  buildOptions,
  testCodegenOptions,
}: StartTestServerOptions<import('../src/hapi').EnvelopAppOptions, import('../src/hapi').BuildAppOptions>) {
  const { CreateApp } = await import('../src/hapi');

  const port = await getPort();

  const server = (await import('@hapi/hapi')).server({
    port,
    host: 'localhost',
  });

  const { tmpPath, tmpSchemaPath, codegenPromise } = await Codegen(options, testCodegenOptions);

  const app = CreateApp(options).buildApp(buildOptions);

  await server.register(app.plugin);

  await server.start();

  TearDownPromises.push(
    LazyPromise(async () => {
      await server.stop();
    })
  );

  return { ...getRequestPool(port), tmpPath, tmpSchemaPath, codegenPromise };
}

export async function startKoaServer({
  options = {},
  buildOptions = {},
  testCodegenOptions,
}: StartTestServerOptions<import('../src/koa').EnvelopAppOptions, import('../src/koa').BuildAppOptions>) {
  const Koa = (await import('koa')).default;
  const KoaRouter = (await import('@koa/router')).default;

  const app = new Koa();

  const router = new KoaRouter();

  const { CreateApp } = await import('../src/koa');

  const { tmpPath, tmpSchemaPath, codegenPromise } = await Codegen(options, testCodegenOptions);

  await CreateApp(options).buildApp({ router, ...buildOptions });

  app.use(router.routes()).use(router.allowedMethods());

  const port = await getPort();

  await new Promise<void>(resolve => {
    const server = app.listen(port, resolve);

    TearDownPromises.push(new PLazy(resolve => server.close(resolve)));
  });

  return { ...getRequestPool(port), tmpPath, tmpSchemaPath, codegenPromise };
}

function getRequestPool(port: number) {
  const address = `http://127.0.0.1:${port}`;
  const requestPool = new Pool(address, {
    connections: 5,
  });

  TearDownPromises.push(LazyPromise(async () => requestPool.close()));

  return {
    address,
    async request(options: RequestOptions) {
      const { body } = await requestPool.request(options);

      return getStringFromStream(body);
    },
    async query<TData, TVariables>(
      document: TypedDocumentNode<TData, TVariables> | string,
      variables?: TVariables
    ): Promise<ExecutionResult<TData>> {
      const { body } = await requestPool.request({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: Readable.from(JSON.stringify({ query: typeof document === 'string' ? document : print(document), variables }), {
          objectMode: false,
        }),
        path: '/graphql',
      });

      return getJSONFromStream(body);
    },
  };
}

function getStringFromStream(stream: import('stream').Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];

    stream.on('data', chunk => {
      chunks.push(chunk);
    });

    stream.on('end', () => {
      try {
        resolve(Buffer.concat(chunks).toString('utf-8'));
      } catch (err) {
        reject(err);
      }
    });
  });
}

function getJSONFromStream<T>(stream: import('stream').Readable): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];

    stream.on('data', chunk => {
      chunks.push(chunk);
    });

    stream.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
      } catch (err) {
        reject(err);
      }
    });
  });
}
