import getPort from 'get-port';
import { request } from 'undici';
import { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { ExecutionResult, print } from 'graphql';

const TearDownCallbacks = Array<() => Promise<unknown>>();

afterAll(async () => {
  await Promise.all([...Array.from(TearDownCallbacks).map(cb => cb())]);
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

  const { CreateApp } = await import('../src/express');

  const appBuilder = CreateApp(options);

  app.use(await appBuilder.buildApp({ app, ...buildOptions }));

  const port = await getPort();

  await new Promise<void>(resolve => {
    const server = app.listen(port, resolve);

    TearDownCallbacks.push(() => new Promise(resolve => server.close(resolve)));
  });

  return async function <TData, TVariables>(document: TypedDocumentNode<TData, TVariables>, variables?: TVariables) {
    const { body } = await request(`http://127.0.0.1:${port}/graphql`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ query: print(document), variables }),
      path: null as any,
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
