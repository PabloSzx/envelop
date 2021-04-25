import assert from 'assert';
import { getGraphQLParameters, processRequest } from 'graphql-helix';
import { gql, Module, TypeDefs } from 'graphql-modules';

import { handleIDE, IDEOptions } from './common/ide.js';
import { BaseEnvelopAppOptions, createEnvelopAppFactory } from './common/app.js';
import { BuildSubscriptionsContext, CreateSubscriptionsServer, SubscriptionsFlag } from './common/subscriptions/websocket.js';
import { getPathname } from './common/utils/url.js';

import type { Envelop } from '@envelop/types';
import type { ExecutionContext } from 'graphql-helix/dist/types';
import type { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest, RouteOptions } from 'fastify';
import type { Server, IncomingMessage } from 'http';
import type { EnvelopModuleConfig, EnvelopContext } from './common/types';
import type { Socket } from 'net';
import type { AltairFastifyPluginOptions } from 'altair-fastify-plugin';

export type EnvelopAppPlugin = FastifyPluginCallback<{}, Server>;

export interface BuildContextArgs {
  request: FastifyRequest;
  reply: FastifyReply;
}

export interface EnvelopAppOptions extends BaseEnvelopAppOptions<EnvelopContext> {
  /**
   * @default "/graphql"
   */
  path?: string;

  /**
   * Build Context
   */
  buildContext?: (args: BuildContextArgs) => Record<string, unknown> | Promise<Record<string, unknown>>;

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
   */
  ide?: IDEOptions<AltairFastifyPluginOptions>;

  /**
   * Custom Fastify Route options
   */
  routeOptions?: Omit<RouteOptions, 'method' | 'url' | 'handler'>;
}

export interface BuildAppOptions {
  prepare?: () => void | Promise<void>;
}

export interface EnvelopAppBuilder {
  gql: typeof gql;
  modules: Module[];
  registerModule: (typeDefs: TypeDefs, options?: EnvelopModuleConfig | undefined) => Module;
  buildApp(options?: BuildAppOptions): EnvelopAppPlugin;
}

export function CreateApp(config: EnvelopAppOptions = {}): EnvelopAppBuilder {
  const { appBuilder, gql, modules, registerModule } = createEnvelopAppFactory(config, {
    moduleName: 'fastify',
  });
  const { websocketSubscriptions, path = '/graphql', buildWebsocketSubscriptionsContext } = config;

  const subscriptionsClientFactoryPromise = CreateSubscriptionsServer(websocketSubscriptions);

  async function handleSubscriptions(getEnveloped: Envelop<unknown>, instance: FastifyInstance) {
    if (!websocketSubscriptions) return;

    const subscriptionsClientFactory = await subscriptionsClientFactoryPromise;
    assert(subscriptionsClientFactory);

    const subscriptionsServer = subscriptionsClientFactory(getEnveloped, buildWebsocketSubscriptionsContext);

    const wsServers = subscriptionsServer[0] === 'both' ? subscriptionsServer[2] : ([subscriptionsServer[1]] as const);

    let closing = false;

    instance.server.on('upgrade', async (rawRequest: IncomingMessage, socket: Socket, head: Buffer) => {
      const requestUrl = getPathname(rawRequest.url);

      if (closing || requestUrl !== path) {
        return wsServers[0].handleUpgrade(rawRequest, socket, head, (webSocket, _request) => {
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

    instance.addHook('onClose', function (_fastify, done) {
      Promise.all(
        wsServers.map(
          server => new Promise<Error | undefined>(resolve => server.close(err => resolve(err)))
        )
      ).then(() => done(), done);
    });

    const oldClose = instance.server.close;

    // Monkeypatching fastify.server.close as done already in https://github.com/fastify/fastify-websocket/blob/master/index.js#L134
    instance.server.close = function (cb) {
      closing = true;

      oldClose.call(this, cb);

      for (const server of wsServers) {
        for (const client of server.clients) {
          client.close();
        }
      }

      return instance.server;
    };
  }

  function buildApp({ prepare }: BuildAppOptions = {}): EnvelopAppPlugin {
    const { buildContext, path = '/graphql', ide, routeOptions = {} } = config;
    const app = appBuilder({
      prepare,
      adapterFactory(getEnveloped) {
        const EnvelopApp: FastifyPluginCallback<{}> = async function FastifyPlugin(instance) {
          const idePromise = handleIDE(ide, {
            async handleAltair(options) {
              const { default: AltairFastify } = await import('altair-fastify-plugin');

              await instance.register(AltairFastify, {
                subscriptionsEndpoint: `ws://localhost:3000/${path}`,
                ...options,
              });
            },
            handleGraphiQL(options) {
              instance.get(options.path, (_request, reply) => {
                reply.type('text/html').send(options.html);
              });
            },
          });

          const subscriptionsPromise = handleSubscriptions(getEnveloped, instance);

          instance.route({
            ...routeOptions,
            method: ['GET', 'POST'],
            url: path,
            async handler(req, reply) {
              const { parse, validate, contextFactory: contextFactoryEnvelop, execute, schema, subscribe } = getEnveloped();

              const request = {
                body: req.body,
                headers: req.headers,
                method: req.method,
                query: req.query,
              };

              const { operationName, query, variables } = getGraphQLParameters(request);

              async function contextFactory(helixCtx: ExecutionContext) {
                const [envelopCtx, customCtx] = await Promise.all([
                  contextFactoryEnvelop({ reply, ...helixCtx }),
                  buildContext?.({ request: req, reply }),
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
                execute,
                contextFactory,
                subscribe,
              });

              if (result.type === 'RESPONSE') {
                reply.status(result.status);
                reply.send(result.payload);
              } else if (result.type === 'MULTIPART_RESPONSE') {
                reply.status(200);
                reply.headers({
                  Connection: 'keep-alive',
                  'Content-Type': 'multipart/mixed; boundary="-"',
                  'Transfer-Encoding': 'chunked',
                });

                req.raw.on('close', () => {
                  result.unsubscribe();
                });

                reply.raw.write('---');

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

                  reply.raw.write(data.join('\r\n'));
                });

                reply.raw.write('\r\n-----\r\n');
              } else {
                reply.hijack();
                reply.raw.writeHead(200, {
                  'Content-Type': 'text/event-stream',
                  Connection: 'keep-alive',
                  'Cache-Control': 'no-cache',
                });

                req.raw.on('close', () => {
                  result.unsubscribe();
                });

                await result.subscribe(result => {
                  reply.raw.write(`data: ${JSON.stringify(result)}\n\n`);
                });
              }
            },
          });

          await Promise.all([idePromise, subscriptionsPromise]);
        };

        return EnvelopApp;
      },
    });

    return async function (instance, opts) {
      instance.register(await app, opts);
    };
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
