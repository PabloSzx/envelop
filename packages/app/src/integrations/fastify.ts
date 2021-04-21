import assert from 'assert';
import { GraphQLError } from 'graphql';
import { getGraphQLParameters, processRequest } from 'graphql-helix';
import { gql, Module, TypeDefs } from 'graphql-modules';

import { BaseEnvelopAppOptions, createEnvelopAppFactory } from '../common/index.js';
import { CreateSubscriptionsServer, SubscriptionsFlag } from '../common/subscriptions.js';

import type { ExecutionContext } from 'graphql-helix/dist/types';
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import type { Server } from 'http';
import type { EnvelopModuleConfig } from '../common/types';
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
   * Enable Subscriptions
   * TODO: Detect if schema has subscriptions and autoenable by default
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
  const { buildContext, subscriptions } = config;

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

          const subscriptionsClientFactory = await subscriptionsClientFactoryPromise;

          instance.register(AltairFastify, {});

          const subscriptionsServer = subscriptionsClientFactory?.(getEnveloped);

          instance.server.on('upgrade', async (rawRequest, socket, head) => {
            assert(subscriptionsServer, 'Subscriptions client not existant');

            const protocol = rawRequest.headers['sec-websocket-protocol'] || socket.protocol;

            switch (subscriptionsServer[0]) {
              case 'both': {
                const server = subscriptionsServer[1](protocol);

                server.handleUpgrade(rawRequest, socket, head, ws => {
                  server.emit('connection', ws, rawRequest);
                });
                break;
              }
              case 'legacy': {
                const server = subscriptionsServer[1];

                server.handleUpgrade(rawRequest, socket, head, ws => {
                  server.emit('connection', ws, rawRequest);
                });
                break;
              }
              case 'new': {
                const server = subscriptionsServer[1];
                server.handleUpgrade(rawRequest, socket, head, ws => {
                  server.emit('connection', ws, rawRequest);
                });
                break;
              }
            }
          });

          instance.route({
            method: ['GET', 'POST'],
            url: '/graphql',
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
