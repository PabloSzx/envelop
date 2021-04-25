import { getGraphQLParameters, processRequest, renderGraphiQL } from 'graphql-helix';
import { gql, Module, TypeDefs } from 'graphql-modules';
import querystring from 'querystring';

import { BaseEnvelopAppOptions, createEnvelopAppFactory } from './common/app.js';
import { parseIDEConfig } from './common/ide.js';
import { LazyPromise } from './common/LazyPromise/lazyPromise.js';
import { getPathname } from './common/utils/url.js';

import type { ExecutionContext, RenderGraphiQLOptions } from 'graphql-helix/dist/types';
import type { EnvelopModuleConfig, EnvelopContext, IDEOptions } from './common/types';
import type { RenderOptions } from 'altair-static';
import type { IncomingMessage, ServerResponse } from 'http';

export interface BuildContextArgs {
  request: IncomingMessage;
  response: ServerResponse;
}

export interface EnvelopAppOptions extends BaseEnvelopAppOptions<EnvelopContext> {
  /**
   * Build Context
   */
  buildContext?: (args: BuildContextArgs) => Record<string, unknown> | Promise<Record<string, unknown>>;

  /**
   * @default "/graphql"
   */
  path?: string;

  /**
   * IDE configuration
   *
   * @default { altair: true, graphiql: false }
   */
  ide?: IDEOptions;

  /**
   * Handle Not Found
   *
   * @default true
   */
  handleNotFound?: boolean;
}

export interface BuildAppOptions {
  prepare?: () => void | Promise<void>;
}

export type AsyncRequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;
export type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void;

export interface EnvelopAppBuilder {
  gql: typeof gql;
  modules: Module[];
  registerModule: (typeDefs: TypeDefs, options?: EnvelopModuleConfig | undefined) => Module;
  buildApp(options?: BuildAppOptions): AsyncRequestHandler;
}

export function CreateApp(config: EnvelopAppOptions = {}): EnvelopAppBuilder {
  const { appBuilder, gql, modules, registerModule } = createEnvelopAppFactory(config, {
    moduleName: 'http',
  });

  function buildApp({ prepare }: BuildAppOptions): AsyncRequestHandler {
    let app: AsyncRequestHandler | undefined;
    const { buildContext, path = '/graphql', ide = { altair: true, graphiql: false }, handleNotFound = true } = config;

    const appPromise = appBuilder({
      prepare,
      adapterFactory(getEnveloped): AsyncRequestHandler {
        const { altairOptions, graphiQLOptions, isAltairEnabled, isGraphiQLEnabled } = parseIDEConfig(ide);

        return async function (req, res) {
          const pathname = getPathname(req.url)!;

          if (pathname !== path) {
            if (isAltairEnabled && pathname.startsWith(altairOptions.path)) {
              return AltairHandler(altairOptions)(req, res);
            } else if (isGraphiQLEnabled && pathname === graphiQLOptions.path) {
              return GraphiQLHandler(graphiQLOptions)(req, res);
            }

            if (handleNotFound) return res.writeHead(404).end();

            return;
          }

          let payload = '';

          req.on('data', (chunk: Buffer) => {
            payload += chunk.toString('utf-8');
          });

          const { parse, validate, contextFactory: contextFactoryEnvelop, execute, schema, subscribe } = getEnveloped();

          async function contextFactory(helixCtx: ExecutionContext) {
            const [envelopCtx, customCtx] = await Promise.all([
              contextFactoryEnvelop({ response: res, ...helixCtx }),
              buildContext?.({ request: req, response: res }),
            ]);

            return Object.assign(envelopCtx, customCtx);
          }

          req.on('end', async () => {
            try {
              const body = JSON.parse(payload || '{}');

              const urlQuery = req.url?.split('?')[1];

              const request = {
                body,
                headers: req.headers,
                method: req.method!,
                query: urlQuery ? querystring.parse(urlQuery) : {},
              };

              const { operationName, query, variables } = getGraphQLParameters(request);

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
                res.writeHead(result.status, {
                  'content-type': 'application/json',
                });

                res.end(JSON.stringify(result.payload));
              } else if (result.type === 'MULTIPART_RESPONSE') {
                res.writeHead(200, {
                  Connection: 'keep-alive',
                  'Content-Type': 'multipart/mixed; boundary="-"',
                  'Transfer-Encoding': 'chunked',
                  'Content-Encoding': 'none',
                });

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
            } catch (err) {
              res
                .writeHead(500, {
                  'Content-Type': 'application/json',
                })
                .end(
                  JSON.stringify({
                    message: err.message,
                  })
                );
            }
          });
        };
      },
    });

    appPromise.then(handler => {
      app = handler;
    });

    return async function (req, res) {
      try {
        await (app || (await appPromise))(req, res);
      } catch (err) {
        res
          .writeHead(500, {
            'content-type': 'application/json',
          })
          .end(
            JSON.stringify({
              message: err.message,
            })
          );
      }
    };
  }

  return {
    buildApp,
    gql,
    modules,
    registerModule,
  };
}

export interface GraphiQLHandlerOptions extends RenderGraphiQLOptions {}

export function GraphiQLHandler(options: GraphiQLHandlerOptions = {}): RequestHandler {
  const { endpoint = '/graphql', ...renderOptions } = options;
  return function (req, res) {
    if (req.method !== 'GET') return res.writeHead(404).end();

    res.setHeader('content-type', 'text/html');

    res.end(renderGraphiQL({ ...renderOptions, endpoint }));
  };
}

export interface AltairHandlerOptions extends Omit<RenderOptions, 'baseURL'> {
  /**
   *  Request Path
   *
   * @default "/altair"
   */
  path?: string;
}

export function AltairHandler(options: AltairHandlerOptions = {}): AsyncRequestHandler {
  let { path = '/altair', endpointURL = '/graphql', ...renderOptions } = options;

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
    try {
      const { renderAltair, getDistDirectory, readFile, resolve, lookup } = await deps;
      switch (req.url) {
        case path:
        case baseURL: {
          res.setHeader('content-type', 'text/html');
          res.end(
            renderAltair({
              ...renderOptions,
              baseURL,
              endpointURL,
            })
          );
          return;
        }
        case undefined: {
          return res.writeHead(404).end();
        }
        default: {
          const resolvedPath = resolve(getDistDirectory(), req.url.slice(baseURL.length));

          const result = await readFile(resolvedPath).catch(() => {});

          if (!result) return res.writeHead(404).end();

          const contentType = lookup(resolvedPath);
          if (contentType) res.setHeader('content-type', contentType);
          return res.end(result);
        }
      }
    } catch (err) {
      res
        .writeHead(500, {
          'content-type': 'application/json',
        })
        .end(
          JSON.stringify({
            message: err.message,
          })
        );
    }
  };
}

export { gql, getPathname };

export * from './common/types.js';
export * from './common/LazyPromise/lazyPromise.js';
