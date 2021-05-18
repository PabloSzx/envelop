import assert from 'assert';
import { gql } from 'graphql-modules';

import { BaseEnvelopAppOptionsWithUpload, BaseEnvelopBuilder, createEnvelopAppFactory, handleRequest } from './common/app.js';
import { handleIDE, IDEOptions } from './common/ide/handle.js';
import { CreateSubscriptionsServer, WebSocketSubscriptionsOptions } from './common/subscriptions/websocket.js';

import type { Envelop } from '@envelop/types';
import type { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest, RouteOptions } from 'fastify';
import type { Server } from 'http';
import type { EnvelopContext } from './common/types';
import type { AltairFastifyPluginOptions } from 'altair-fastify-plugin';

export type EnvelopAppPlugin = FastifyPluginCallback<{}, Server>;

export interface BuildContextArgs {
  request: FastifyRequest;
  response: FastifyReply;
}

export interface EnvelopAppOptions extends BaseEnvelopAppOptionsWithUpload<EnvelopContext> {
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
  websocketSubscriptions?: WebSocketSubscriptionsOptions;

  /**
   * IDE configuration
   */
  ide?: IDEOptions<AltairFastifyPluginOptions>;

  /**
   * Custom Fastify Route options
   */
  routeOptions?: Omit<RouteOptions, 'method' | 'url' | 'handler'>;
}

declare module 'fastify' {
  interface FastifyRequest {
    isMultipart?: true;
  }
}

export interface BuildAppOptions {
  prepare?: (appBuilder: BaseEnvelopBuilder) => void | Promise<void>;
}

export interface EnvelopApp {
  plugin: EnvelopAppPlugin;
  getEnveloped: Promise<Envelop<unknown>>;
}

export interface EnvelopAppBuilder extends BaseEnvelopBuilder {
  buildApp(options?: BuildAppOptions): EnvelopApp;
}

export function CreateApp(config: EnvelopAppOptions = {}): EnvelopAppBuilder {
  const { appBuilder, ...commonApp } = createEnvelopAppFactory(config, {
    moduleName: 'fastify',
  });
  const { websocketSubscriptions, path = '/graphql', GraphQLUpload = false } = config;

  const subscriptionsClientFactoryPromise = CreateSubscriptionsServer(websocketSubscriptions);

  async function handleSubscriptions(getEnveloped: Envelop<unknown>, instance: FastifyInstance) {
    if (!websocketSubscriptions) return;

    const subscriptionsClientFactory = await subscriptionsClientFactoryPromise;
    assert(subscriptionsClientFactory);

    const handleUpgrade = subscriptionsClientFactory(getEnveloped);

    const state = handleUpgrade(instance.server, path);

    instance.addHook('onClose', function (_fastify, done) {
      Promise.all(
        state.wsServers.map(server => new Promise<Error | undefined>(resolve => server.close(err => resolve(err))))
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

  function buildApp({ prepare }: BuildAppOptions = {}): EnvelopApp {
    const { buildContext, path = '/graphql', ide, routeOptions = {}, customHandleRequest } = config;
    const appPromise = appBuilder({
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

          if (GraphQLUpload) {
            const processRequest: typeof import('graphql-upload').processRequest = (
              await import('graphql-upload/public/processRequest.js')
            ).default;

            instance.addContentTypeParser('multipart', (req, _payload, done) => {
              req.isMultipart = true;
              done(null);
            });

            instance.addHook('preValidation', async function (request, reply) {
              if (!request.isMultipart) return;

              request.body = await processRequest(
                request.raw,
                reply.raw,
                typeof GraphQLUpload === 'object' ? GraphQLUpload : undefined
              );
            });
          }

          const requestHandler = customHandleRequest || handleRequest;

          instance.route({
            ...routeOptions,
            method: ['GET', 'POST'],
            url: path,
            handler(req, reply) {
              const request = {
                body: req.body,
                headers: req.headers,
                method: req.method,
                query: req.query,
              };

              return requestHandler({
                request,
                getEnveloped,
                baseOptions: config,
                buildContextArgs() {
                  return {
                    request: req,
                    response: reply,
                  };
                },
                buildContext,
                onResponse(result) {
                  reply.status(result.status);
                  reply.send(result.payload);
                },
                onMultiPartResponse(result, defaultHandle) {
                  return defaultHandle(req.raw, reply.raw, result);
                },
                onPushResponse(result, defaultHandle) {
                  reply.hijack();
                  return defaultHandle(req.raw, reply.raw, result);
                },
              });
            },
          });

          await Promise.all([idePromise, subscriptionsPromise]);
        };
      },
    });

    return {
      async plugin(instance) {
        await (await appPromise).app(instance);
      },
      getEnveloped: appPromise.then(v => v.getEnveloped),
    };
  }

  return {
    ...commonApp,
    buildApp,
  };
}

export { gql };

export * from './common/base.js';
