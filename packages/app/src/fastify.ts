import assert from 'assert';
import { getGraphQLParameters, processRequest } from 'graphql-helix';
import { gql } from 'graphql-modules';

import { BaseEnvelopAppOptions, BaseEnvelopBuilder, createEnvelopAppFactory } from './common/app.js';
import { handleIDE, IDEOptions } from './common/ide/handle.js';
import { CreateSubscriptionsServer, WebsocketSubscriptionsOptions } from './common/subscriptions/websocket.js';

import type { Envelop } from '@envelop/types';
import type { ExecutionContext } from 'graphql-helix/dist/types';
import type { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest, RouteOptions } from 'fastify';
import type { Server } from 'http';
import type { EnvelopContext } from './common/types';
import type { AltairFastifyPluginOptions } from 'altair-fastify-plugin';

export type EnvelopAppPlugin = FastifyPluginCallback<{}, Server>;

export interface BuildContextArgs {
  request: FastifyRequest;
  response: FastifyReply;
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
   * Websocket Suscriptions configuration
   */
  websocketSubscriptions?: WebsocketSubscriptionsOptions;

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

export interface EnvelopAppBuilder extends BaseEnvelopBuilder {
  buildApp(options?: BuildAppOptions): EnvelopAppPlugin;
}

export function CreateApp(config: EnvelopAppOptions = {}): EnvelopAppBuilder {
  const { appBuilder, ...commonApp } = createEnvelopAppFactory(config, {
    moduleName: 'fastify',
  });
  const { websocketSubscriptions, path = '/graphql' } = config;

  const subscriptionsClientFactoryPromise = CreateSubscriptionsServer(websocketSubscriptions);

  async function handleSubscriptions(getEnveloped: Envelop<unknown>, instance: FastifyInstance) {
    if (!websocketSubscriptions) return;

    const subscriptionsClientFactory = await subscriptionsClientFactoryPromise;
    assert(subscriptionsClientFactory);

    const handleUpgrade = subscriptionsClientFactory(getEnveloped);

    const state = handleUpgrade(instance.server, path);

    instance.addHook('onClose', function (_fastify, done) {
      Promise.all(
        state.wsServers.map(
          server => new Promise<Error | undefined>(resolve => server.close(err => resolve(err)))
        )
      ).then(() => done(), done);
    });

    const oldClose = instance.server.close;

    // Monkeypatching fastify.server.close as done already in https://github.com/fastify/fastify-websocket/blob/master/index.js#L134
    instance.server.close = function (cb) {
      state.closing = true;

      oldClose.call(this, cb);

      for (const wsServer of state.wsServers) {
        for (const client of wsServer.clients) {
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
        return async function FastifyPlugin(instance: FastifyInstance) {
          const idePromise = handleIDE(ide, path, {
            async handleAltair({ path, ...ideOptions }) {
              const { default: AltairFastify } = await import('altair-fastify-plugin');

              await instance.register(AltairFastify, {
                path,
                ...ideOptions,
              });

              instance.get(path.endsWith('/') ? path.slice(0, path.length - 1) : path + '/', (_request, reply) => {
                reply.redirect(path);
              });
            },
            handleGraphiQL({ path, html }) {
              instance.get(path, (_request, reply) => {
                reply.type('text/html').send(html);
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
                if (buildContext) {
                  return contextFactoryEnvelop(
                    Object.assign(
                      {},
                      helixCtx,
                      await buildContext({
                        request: req,
                        response: reply,
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
      },
    });

    return async function EnvelopPlugin(instance) {
      await (await app)(instance);
    };
  }

  return {
    ...commonApp,
    buildApp,
  };
}

export { gql };

export * from './common/base.js';
export * from './common/LazyPromise/lazyPromise.js';
