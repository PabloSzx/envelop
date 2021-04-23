import assert from 'assert';
import { GraphQLError } from 'graphql';
import { getGraphQLParameters, processRequest } from 'graphql-helix';
import { gql, Module, TypeDefs } from 'graphql-modules';

import { BaseEnvelopAppOptions, createEnvelopAppFactory } from '../common/index.js';
import { BuildSubscriptionContext, CreateSubscriptionsServer, SubscriptionsFlag } from '../common/subscriptions.js';

import type { ExecutionContext } from 'graphql-helix/dist/types';
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import type { Server, IncomingMessage } from 'http';
import type { EnvelopModuleConfig } from '../common/types';
import type { Socket } from 'net';
export interface FastifyEnvelopApp {
  EnvelopAppPlugin: FastifyPluginCallback<Record<never, never>, Server>;
}

export interface FastifyContextArgs {
  request: FastifyRequest;
  reply: FastifyReply;
}

export interface FastifyEnvelopAppOptions extends BaseEnvelopAppOptions {
  /**
   * Build Context
   */
  buildContext?: (args: FastifyContextArgs) => Record<string, unknown> | Promise<Record<string, unknown>>;

  /**
   * Build Context for subscriptions
   */
  buildSubscriptionsContext?: BuildSubscriptionContext;

  /**
   * Enable Subscriptions
   */
  subscriptions?: SubscriptionsFlag;
}

export interface FastifyEnvelopContext {
  reply: FastifyReply;
}

export interface FastifyEnvelopAppBuilder {
  gql: typeof gql;
  modules: Module[];
  registerModule: (typeDefs: TypeDefs, options?: EnvelopModuleConfig | undefined) => Module;
  buildApp: {
    (prepare?: undefined): FastifyEnvelopApp;
    (prepare: () => Promise<void>): Promise<FastifyEnvelopApp>;
    (prepare: () => void): FastifyEnvelopApp;
  };
}

export function CreateFastifyApp(config: FastifyEnvelopAppOptions = {}): FastifyEnvelopAppBuilder {
  const { appBuilder, gql, modules, registerModule } = createEnvelopAppFactory(config, {
    contextTypeName: 'FastifyEnvelopContext',
  });
  const { buildContext, subscriptions, path = '/graphql', buildSubscriptionsContext } = config;

  const subscriptionsClientFactoryPromise = CreateSubscriptionsServer(subscriptions);

  function buildApp(prepare?: undefined): FastifyEnvelopApp;
  function buildApp(prepare: () => Promise<void>): Promise<FastifyEnvelopApp>;
  function buildApp(prepare: () => void): FastifyEnvelopApp;
  function buildApp(prepare?: () => Promise<void> | void): FastifyEnvelopApp | Promise<FastifyEnvelopApp> {
    return appBuilder({
      prepare,
      adapterFactory(getEnveloped) {
        const EnvelopAppPlugin: FastifyPluginCallback = async function FastifyPlugin(instance, _opts) {
          const { default: AltairFastify } = await import('altair-fastify-plugin');

          instance.register(AltairFastify, {
            subscriptionsEndpoint: `ws://localhost:3000/${path}`,
          });

          if (subscriptions) {
            const subscriptionsClientFactory = await subscriptionsClientFactoryPromise;
            assert(subscriptionsClientFactory);

            const subscriptionsServer = subscriptionsClientFactory(getEnveloped, buildSubscriptionsContext);

            const wsServers = subscriptionsServer[0] === 'both' ? subscriptionsServer[2] : ([subscriptionsServer[1]] as const);

            function getPathname(path?: string) {
              return path && new URL('http://_' + path).pathname;
            }

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

          instance.route({
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

              const contextFactory = async (helixCtx: ExecutionContext) => {
                const [envelopCtx, customCtx] = await Promise.all([
                  contextFactoryEnvelop({ reply, ...helixCtx }),
                  buildContext?.({ request: req, reply }),
                ]);

                return Object.assign(envelopCtx, customCtx);
              };

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
                reply.status(422);
                reply.send({
                  errors: [new GraphQLError('Subscriptions should be sent over WebSocket.')],
                });
              }
            },
          });
        };

        return {
          EnvelopAppPlugin,
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
