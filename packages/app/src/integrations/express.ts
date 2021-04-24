import assert from 'assert';
import { getGraphQLParameters, processRequest } from 'graphql-helix';
import { gql, Module, TypeDefs } from 'graphql-modules';
import { createServer, IncomingMessage, Server } from 'http';

import { IDEOptions, handleIDE } from '../common/ide.js';
import { BaseEnvelopAppOptions, createEnvelopAppFactory } from '../common/index.js';
import { BuildSubscriptionsContext, CreateSubscriptionsServer, SubscriptionsFlag } from '../common/websocketSubscriptions.js';
import { getPathname } from '../common/url.js';

import type { Socket } from 'net';
import type { Envelop } from '@envelop/types';
import type { ExecutionContext } from 'graphql-helix/dist/types';
import type { Request, Response, Router, Express } from 'express';
import type { EnvelopModuleConfig } from '../common/types';
import type { OptionsJson as BodyParserOptions } from 'body-parser';

export interface ExpressEnvelopApp {
  EnvelopApp: Router;
}

export interface ExpressContextArgs {
  request: Request;
  response: Response;
}

export interface ExpressEnvelopAppOptions extends BaseEnvelopAppOptions {
  /**
   * @default "/graphql"
   */
  path?: string;

  /**
   * JSON body-parser options
   */
  bodyParserJSONOptions?: BodyParserOptions;

  /**
   * Build Context
   */
  buildContext?: (args: ExpressContextArgs) => Record<string, unknown> | Promise<Record<string, unknown>>;

  /**
   * Build Context for subscriptions
   */
  buildWebsocketSubscriptionsContext?: BuildSubscriptionsContext;

  /**
   * Enable Websocket Subscriptions
   */
  websocketSubscriptions?: SubscriptionsFlag;

  /**
   * IDE configuration
   *
   * @default { altair: true, graphiql: false }
   */
  ide?: IDEOptions;
}

export interface ExpressEnvelopContext {
  request: Request;
  response: Response;
}

export interface BuildExpressAppOptions {
  app: Express;
  server?: Server;
  prepare?: () => void | Promise<void>;
}

export interface ExpressEnvelopAppBuilder {
  gql: typeof gql;
  modules: Module[];
  registerModule: (typeDefs: TypeDefs, options?: EnvelopModuleConfig | undefined) => Module;
  buildApp(options: BuildExpressAppOptions): Promise<ExpressEnvelopApp>;
}

export function CreateExpressApp(config: ExpressEnvelopAppOptions = {}): ExpressEnvelopAppBuilder {
  const { appBuilder, gql, modules, registerModule } = createEnvelopAppFactory(config, {
    contextTypeName: 'ExpressEnvelopContext',
  });

  const {
    buildContext,
    path = '/graphql',
    websocketSubscriptions,
    buildWebsocketSubscriptionsContext,
    bodyParserJSONOptions: jsonOptions,
    ide,
  } = config;

  const subscriptionsClientFactoryPromise = CreateSubscriptionsServer(websocketSubscriptions);

  async function handleSubscriptions(getEnveloped: Envelop<unknown>, appInstance: Express, optionsServer: Server | undefined) {
    if (!websocketSubscriptions) return;

    const subscriptionsClientFactory = await subscriptionsClientFactoryPromise;
    assert(subscriptionsClientFactory);

    const subscriptionsServer = subscriptionsClientFactory(getEnveloped, buildWebsocketSubscriptionsContext);

    const wsServers = subscriptionsServer[0] === 'both' ? subscriptionsServer[2] : ([subscriptionsServer[1]] as const);

    const server = optionsServer || createServer(appInstance);

    appInstance.listen = (...args: any[]) => {
      return server.listen(...args);
    };

    let closing = false;

    server.on('upgrade', (rawRequest: IncomingMessage, socket: Socket, head: Buffer) => {
      const requestUrl = getPathname(rawRequest.url);

      if (closing || requestUrl !== path) {
        return wsServers[0].handleUpgrade(rawRequest, socket, head, webSocket => {
          webSocket.close(1001);
        });
      }

      const protocol = rawRequest.headers['sec-websocket-protocol'];

      switch (subscriptionsServer[0]) {
        case 'both': {
          const server = subscriptionsServer[1](protocol);

          return server.handleUpgrade(rawRequest, socket, head, ws => {
            server.emit('connection', ws, rawRequest);
          });
        }
        case 'new':
        case 'legacy': {
          const server = subscriptionsServer[1];

          return server.handleUpgrade(rawRequest, socket, head, ws => {
            server.emit('connection', ws, rawRequest);
          });
        }
      }
    });

    const oldClose = server.close;
    server.close = function (cb) {
      closing = true;

      oldClose.call(this, cb);

      for (const server of wsServers) {
        for (const client of server.clients) {
          client.close();
        }
      }

      return server;
    };
  }

  async function buildApp(buildOptions: BuildExpressAppOptions): Promise<ExpressEnvelopApp> {
    return appBuilder({
      prepare: buildOptions.prepare,
      async adapterFactory(getEnveloped) {
        const { Router, json } = await import('express');

        const EnvelopApp = Router();

        EnvelopApp.use(json(jsonOptions));

        const IDEPromise = handleIDE(ide, {
          async handleAltair(options) {
            const { altairExpress } = await import('altair-express-middleware');

            EnvelopApp.use(
              '/altair',
              altairExpress({
                ...options,
              })
            );
          },
          handleGraphiQL(options) {
            EnvelopApp.use(options.path, (_req, res) => {
              res.type('html').send(options.html);
            });
          },
        });

        const subscriptionsPromise = handleSubscriptions(getEnveloped, buildOptions.app, buildOptions.server);

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
            result.headers.forEach(({ name, value }) => res.setHeader(name, value));
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

        return {
          EnvelopApp,
        };
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

export * from '../common/types.js';
