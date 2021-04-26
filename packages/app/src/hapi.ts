import { getGraphQLParameters, processRequest } from 'graphql-helix';
import { gql, Module, TypeDefs } from 'graphql-modules';

import { BaseEnvelopAppOptions, createEnvelopAppFactory } from './common/app.js';
import { handleIDE } from './common/ide/handle.js';
import { RawAltairHandler } from './common/ide/rawAltair.js';

import type { ExecutionContext } from 'graphql-helix/dist/types';
import type { EnvelopModuleConfig, EnvelopContext, IDEOptions } from './common/types';
import type { Request, ResponseToolkit, Plugin, Server } from '@hapi/hapi';
export interface BuildContextArgs {
  request: Request;
  h: ResponseToolkit;
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
   * @default { altair: true, graphiql: true }
   */
  ide?: IDEOptions;
}

export interface BuildAppOptions {
  prepare?: () => void | Promise<void>;
}

export interface EnvelopAppBuilder {
  gql: typeof gql;
  modules: Module[];
  registerModule: (typeDefs: TypeDefs, options?: EnvelopModuleConfig | undefined) => Module;
  buildApp(options: BuildAppOptions): Plugin<{}>;
}

export function CreateApp(config: EnvelopAppOptions = {}): EnvelopAppBuilder {
  const { appBuilder, gql, modules, registerModule } = createEnvelopAppFactory(config, {
    moduleName: 'hapi',
  });

  function buildApp({ prepare }: BuildAppOptions): Plugin<{}> {
    const { ide, path = '/graphql', buildContext } = config;

    const registerApp = appBuilder({
      prepare,
      adapterFactory(getEnveloped) {
        return async function register(server: Server) {
          await handleIDE(ide, path, {
            handleAltair({ path, ...renderOptions }) {
              const altairHandler = RawAltairHandler({
                path,
                ...renderOptions,
              });

              const basePath = path.endsWith('/') ? path.slice(0, path.length - 1) : path;

              const wildCardPath = `${basePath}/{any*}`;

              async function handler(req: Request, h: ResponseToolkit) {
                await altairHandler(req.raw.req, req.raw.res);

                return h.abandon;
              }

              server.route({
                path: wildCardPath,
                method: 'GET',
                handler,
              });
            },
            handleGraphiQL({ path, html }) {
              server.route({
                path,
                method: 'GET',
                handler(_req, h) {
                  return h.response(html).type('text/html');
                },
              });
            },
          });

          server.route({
            path,
            method: ['GET', 'POST'],
            async handler(req, h) {
              const request = {
                body: req.payload,
                headers: req.headers,
                method: req.method,
                query: req.query,
              };

              const { operationName, query, variables } = getGraphQLParameters(request);

              const { parse, validate, contextFactory: contextFactoryEnvelop, execute, schema, subscribe } = getEnveloped();

              async function contextFactory(helixCtx: ExecutionContext) {
                if (buildContext) {
                  return contextFactoryEnvelop(
                    Object.assign(
                      {},
                      helixCtx,
                      await buildContext({
                        request: req,
                        h,
                      })
                    )
                  );
                }

                return contextFactoryEnvelop(helixCtx);
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
                return h.response(result.payload).code(result.status).type('application/json');
              } else if (result.type === 'MULTIPART_RESPONSE') {
                req.raw.res.writeHead(200, {
                  Connection: 'keep-alive',
                  'Content-Type': 'multipart/mixed; boundary="-"',
                  'Transfer-Encoding': 'chunked',
                  'Content-Encoding': 'none',
                });

                req.raw.req.on('close', () => {
                  result.unsubscribe();
                });

                req.raw.res.write('---');

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

                  req.raw.res.write(data.join('\r\n'));
                });

                req.raw.res.write('\r\n-----\r\n');
                req.raw.res.end();

                return h.abandon;
              } else {
                req.raw.res.writeHead(200, {
                  'Content-Encoding': 'none',
                  'Content-Type': 'text/event-stream',
                  Connection: 'keep-alive',
                  'Cache-Control': 'no-cache',
                });

                req.raw.req.on('close', () => {
                  result.unsubscribe();
                });

                await result.subscribe(result => {
                  req.raw.res.write(`data: ${JSON.stringify(result)}\n\n`);
                });

                return h.abandon;
              }
            },
          });
        };
      },
    });

    return {
      name: 'EnvelopApp',
      async register(server) {
        await (await registerApp)(server);
      },
    };
  }

  return {
    buildApp,
    gql,
    modules,
    registerModule,
  };
}

export { gql };
export * from './common/types.js';
export * from './common/LazyPromise/lazyPromise.js';
