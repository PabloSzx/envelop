import assert from 'assert';
import { Express, json, Request, Response, Router } from 'express';
import { getGraphQLParameters, processRequest } from 'graphql-helix';
import { gql, Module, TypeDefs } from 'graphql-modules';
import { createServer, Server } from 'http';

import { BaseEnvelopAppOptions, createEnvelopAppFactory } from './common/app.js';
import { handleIDE, IDEOptions } from './common/ide/handle.js';
import { CreateSubscriptionsServer, WebsocketSubscriptionsOptions } from './common/subscriptions/websocket.js';

import type { Envelop } from '@envelop/types';
import type { ExecutionContext } from 'graphql-helix/dist/types';
import type { EnvelopModuleConfig, EnvelopContext } from './common/types';
import type { OptionsJson as BodyParserOptions } from 'body-parser';

export interface BuildContextArgs {
  request: Request;
  response: Response;
}

export interface EnvelopAppOptions extends BaseEnvelopAppOptions<EnvelopContext> {
  /**
   * @default "/graphql"
   */
  path?: string;

  /**
   * JSON body-parser options
   */
  bodyParserJSONOptions?: BodyParserOptions | false;

  /**
   * Build Context
   */
  buildContext?: (args: BuildContextArgs) => Record<string, unknown> | Promise<Record<string, unknown>>;

  /**
   * Websocket Subscriptions configuration
   */
  websocketSubscriptions?: WebsocketSubscriptionsOptions;

  /**
   * IDE configuration
   *
   * @default { altair: true, graphiql: true }
   */
  ide?: IDEOptions;
}

export interface BuildAppOptions {
  app: Express;
  server?: Server;
  prepare?: () => void | Promise<void>;
}

export interface EnvelopAppBuilder {
  gql: typeof gql;
  modules: Module[];
  registerModule: (typeDefs: TypeDefs, options?: EnvelopModuleConfig | undefined) => Module;
  buildApp(options: BuildAppOptions): Promise<Router>;
}

export function CreateApp(config: EnvelopAppOptions = {}): EnvelopAppBuilder {
  const { appBuilder, gql, modules, registerModule } = createEnvelopAppFactory(config, {
    moduleName: 'express',
  });

  const { path = '/graphql', websocketSubscriptions } = config;

  const subscriptionsClientFactoryPromise = CreateSubscriptionsServer(websocketSubscriptions);

  async function handleSubscriptions(getEnveloped: Envelop<unknown>, appInstance: Express, optionsServer: Server | undefined) {
    if (!websocketSubscriptions) return;

    const subscriptionsClientFactory = await subscriptionsClientFactoryPromise;
    assert(subscriptionsClientFactory);

    const handleUpgrade = subscriptionsClientFactory(getEnveloped);

    const server = optionsServer || createServer(appInstance);

    appInstance.listen = (...args: any[]) => {
      return server.listen(...args);
    };

    const state = handleUpgrade(server, path);

    const oldClose = server.close;
    server.close = function (cb) {
      state.closing = true;

      oldClose.call(this, cb);

      for (const wsServer of state.wsServers) {
        for (const client of wsServer.clients) {
          client.close();
        }
        wsServer.close();
      }

      return server;
    };
  }

  async function buildApp({ prepare, app, server }: BuildAppOptions): Promise<Router> {
    const { buildContext, path = '/graphql', bodyParserJSONOptions: jsonOptions = {}, ide } = config;
    return appBuilder({
      prepare,
      async adapterFactory(getEnveloped) {
        const EnvelopApp = Router();

        if (jsonOptions) EnvelopApp.use(json(jsonOptions));

        const IDEPromise = handleIDE(ide, path, {
          async handleAltair(ideOptions) {
            const { altairExpress } = await import('altair-express-middleware');

            EnvelopApp.use(ideOptions.path, altairExpress(ideOptions));
          },
          handleGraphiQL({ path, html }) {
            EnvelopApp.use(path, (_req, res) => {
              res.type('html').send(html);
            });
          },
        });

        const subscriptionsPromise = handleSubscriptions(getEnveloped, app, server);

        EnvelopApp.use(path, async (req, res) => {
          const request = {
            body: req.body,
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
                    response: res,
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
            res.type('application/json');
            res.status(result.status);
            res.json(result.payload);
          } else if (result.type === 'MULTIPART_RESPONSE') {
            res.writeHead(200, {
              Connection: 'keep-alive',
              'Content-Type': 'multipart/mixed; boundary="-"',
              'Transfer-Encoding': 'chunked',
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
        });

        await Promise.all([IDEPromise, subscriptionsPromise]);

        return EnvelopApp;
      },
    });
  }

  return {
    gql,
    modules,
    registerModule,
    buildApp,
  };
}

export { gql };

export * from './common/types.js';
export * from './common/LazyPromise/lazyPromise.js';
