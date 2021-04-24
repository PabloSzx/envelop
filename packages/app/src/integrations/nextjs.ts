import { getGraphQLParameters, processRequest, renderGraphiQL } from 'graphql-helix';
import { gql, Module, TypeDefs } from 'graphql-modules';

import { BaseEnvelopAppOptions, createEnvelopAppFactory } from '../common';
import { LazyPromise } from '../common/lazyPromise';

import type { ExecutionContext, RenderGraphiQLOptions } from 'graphql-helix/dist/types';
import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import type { EnvelopModuleConfig } from '../common/types';
import type { RenderOptions } from 'altair-static';

export interface NextjsContextArgs {
  request: NextApiRequest;
  response: NextApiResponse;
}

export interface NextjsEnvelopAppOptions extends BaseEnvelopAppOptions {
  /**
   * Build Context
   */
  buildContext?: (args: NextjsContextArgs) => Record<string, unknown> | Promise<Record<string, unknown>>;
}

export interface NextjsEnvelopContext {}

export interface BuildNextjsAppOptions {
  prepare?: () => void | Promise<void>;
}

export interface NextjsEnvelopAppBuilder {
  gql: typeof gql;
  modules: Module[];
  registerModule: (typeDefs: TypeDefs, options?: EnvelopModuleConfig | undefined) => Module;
  buildApp(options?: BuildNextjsAppOptions): NextApiHandler<unknown>;
}

export function CreateNextjsApp(config: NextjsEnvelopAppOptions = {}): NextjsEnvelopAppBuilder {
  const { appBuilder, gql, modules, registerModule } = createEnvelopAppFactory(config, {
    contextTypeName: 'NextjsEnvelopContext',
  });

  const { buildContext } = config;

  function buildApp(buildOptions: BuildNextjsAppOptions = {}): NextApiHandler<unknown> {
    const app = appBuilder({
      prepare: buildOptions.prepare,
      async adapterFactory(getEnveloped): Promise<NextApiHandler<unknown>> {
        return async function (req, res) {
          const request = {
            body: req.body,
            headers: req.headers,
            method: req.method!,
            query: req.query,
          };

          const { operationName, query, variables } = getGraphQLParameters(request);

          const { parse, validate, contextFactory: contextFactoryEnvelop, execute, schema, subscribe } = getEnveloped();

          async function contextFactory(helixCtx: ExecutionContext) {
            const [envelopCtx, customCtx] = await Promise.all([
              contextFactoryEnvelop({ response: res, ...helixCtx }),
              buildContext?.({ request: req, response: res }),
            ]);

            return Object.assign(envelopCtx, customCtx);
          }

          const result = await processRequest({
            operationName,
            query,
            variables,
            request,
            schema,
            parse,
            validate,
            contextFactory,
            execute,
            subscribe,
          });

          if (result.type === 'RESPONSE') {
            res.status(result.status).json(result.payload);
          } else if (result.type === 'MULTIPART_RESPONSE') {
            res.writeHead(200, {
              Connection: 'keep-alive',
              'Content-Type': 'multipart/mixed; boundary="-"',
              'Transfer-Encoding': 'chunked',
              'Content-Encoding': 'none',
            });

            // If the request is closed by the client, we unsubscribe and stop executing the request
            req.on('close', () => {
              result.unsubscribe();
            });

            res.write('---');

            await result.subscribe(result => {
              const chunk = Buffer.from(JSON.stringify(result), 'utf8');
              const data = [
                '',
                'Content-Type: application/json; charset=utf-8',
                'Content-Length: ' + String(chunk.length),
                '',
                chunk,
              ];

              if (result.hasNext) {
                data.push('---');
              }

              res.write(data.join('\r\n'));
            });

            res.write('\r\n-----\r\n');
            res.end();
          } else {
            res.writeHead(200, {
              'Content-Encoding': 'none',
              'Content-Type': 'text/event-stream',
              Connection: 'keep-alive',
              'Cache-Control': 'no-cache',
            });

            req.on('close', () => {
              result.unsubscribe();
            });

            await result.subscribe(result => {
              res.write(`data: ${JSON.stringify(result)}\n\n`);
            });
          }
        };
      },
    });

    return async function (req, res) {
      await (await app)(req, res);
    };
  }

  return {
    gql,
    modules,
    registerModule,
    buildApp,
  };
}

export interface NextjsGraphiQLOptions extends RenderGraphiQLOptions {}

export function NextjsGraphiQLHandler(options: NextjsGraphiQLOptions = {}): NextApiHandler<unknown> {
  const { endpoint = '/api/graphql', ...renderOptions } = options;
  return function (req, res) {
    if (req.method !== 'GET') return res.status(404).end();

    res.setHeader('content-type', 'text/html');

    return res.send(renderGraphiQL({ ...renderOptions, endpoint }));
  };
}

export interface NextjsAltairOptions extends Omit<RenderOptions, 'baseURL'> {
  /**
   *  Request Path
   *
   * @default "/api/altair"
   */
  path?: string;
}

export function NextjsAltairHandler(options: NextjsAltairOptions = {}): NextApiHandler<unknown> {
  let { path = '/api/altair', endpointURL = '/api/graphql', ...renderOptions } = options;

  const baseURL = path.endsWith('/') ? (path = path.slice(0, path.length - 1)) + '/' : path + '/';

  const deps = LazyPromise(async () => {
    const [
      { getDistDirectory, renderAltair },
      {
        promises: { readFile },
      },
      { resolve },
      { lookup },
    ] = await Promise.all([import('altair-static'), import('fs'), import('path'), import('mime-types')]);

    return {
      getDistDirectory,
      renderAltair,
      readFile,
      resolve,
      lookup,
    };
  });

  return async function (req, res) {
    const { renderAltair, getDistDirectory, readFile, resolve, lookup } = await deps;
    switch (req.url) {
      case path:
      case baseURL: {
        res.setHeader('content-type', 'text/html');
        res.send(
          renderAltair({
            ...renderOptions,
            baseURL,
            endpointURL,
          })
        );
        return;
      }
      case undefined: {
        return res.status(404).end();
      }
      default: {
        const resolvedPath = resolve(getDistDirectory(), req.url.slice(baseURL.length));

        const result = await readFile(resolvedPath).catch(() => {});

        if (!result) return res.status(404).end();

        const contentType = lookup(resolvedPath);
        if (contentType) res.setHeader('content-type', contentType);
        return res.end(result);
      }
    }
  };
}

export { gql };
