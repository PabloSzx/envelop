/* eslint-disable @typescript-eslint/explicit-module-boundary-types */

import getPort from 'get-port';
import { Pool } from 'undici';
import { ExecutionResult, print } from 'graphql';
import { Readable } from 'stream';
import { LazyPromise, PLazy } from '@envelop/app/extend';
import type { TypedDocumentNode } from '@graphql-typed-document-node/core';

const TearDownPromises: Promise<unknown>[] = [];

afterAll(async () => {
  await Promise.all(TearDownPromises);
});

export async function startExpressServer({
  options,
  buildOptions = {},
}: {
  options?: import('../src/express').EnvelopAppOptions;
  buildOptions?: Partial<import('../src/express').BuildAppOptions>;
}) {
  const app = (await import('express')).default();

  const { CreateApp } = await import('../src/express');

  app.use((await CreateApp(options).buildApp({ app, ...buildOptions })).router);

  const port = await getPort();

  await new Promise<void>(resolve => {
    const server = app.listen(port, resolve);

    TearDownPromises.push(new PLazy(resolve => server.close(resolve)));
  });

  return getRequestPool(port);
}

export async function startFastifyServer({
  options,
  buildOptions,
}: {
  options?: import('../src/fastify').EnvelopAppOptions;
  buildOptions?: Partial<import('../src/fastify').BuildAppOptions>;
}) {
  const app = (await import('fastify')).default();

  const { CreateApp } = await import('../src/fastify');

  app.register(CreateApp(options).buildApp(buildOptions).plugin);

  const port = await getPort();

  await new Promise((resolve, reject) => {
    app.listen(port).then(resolve, reject);

    TearDownPromises.push(
      new PLazy<void>(resolve => app.close(resolve))
    );
  });

  return getRequestPool(port);
}

export async function startHTTPServer({
  options,
  buildOptions,
}: {
  options?: import('../src/http').EnvelopAppOptions;
  buildOptions?: Partial<import('../src/http').BuildAppOptions>;
}) {
  const { CreateApp } = await import('../src/http');

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

  return getRequestPool(port);
}

export async function startHapiServer({
  options,
  buildOptions,
}: {
  options?: import('../src/hapi').EnvelopAppOptions;
  buildOptions?: Partial<import('../src/hapi').BuildAppOptions>;
}) {
  const { CreateApp } = await import('../src/hapi');

  const port = await getPort();

  const server = (await import('@hapi/hapi')).server({
    port,
    host: 'localhost',
  });

  const app = CreateApp(options).buildApp(buildOptions);

  await server.register(app.plugin);

  await server.start();

  TearDownPromises.push(
    LazyPromise(async () => {
      await server.stop();
    })
  );

  return getRequestPool(port);
}

function getRequestPool(port: number) {
  const requestPool = new Pool(`http://127.0.0.1:${port}`, {
    connections: 5,
  });

  TearDownPromises.push(LazyPromise(async () => requestPool.close()));

  return async function <TData, TVariables>(
    document: TypedDocumentNode<TData, TVariables>,
    variables?: TVariables
  ): Promise<ExecutionResult<TData>> {
    const { body } = await requestPool.request({
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: Readable.from(JSON.stringify({ query: print(document), variables }), {
        objectMode: false,
      }),
      path: '/graphql',
    });

    return getJSONFromStream(body);
  };
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
