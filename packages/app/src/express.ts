import assert from 'assert';
import { Express, json, Request, Response, Router } from 'express';
import { gql } from 'graphql-modules';
import { createServer, Server } from 'http';

import { BaseEnvelopAppOptions, BaseEnvelopBuilder, createEnvelopAppFactory, handleRequest } from './common/app.js';
import { handleIDE, IDEOptions } from './common/ide/handle.js';
import { CreateSubscriptionsServer, WebsocketSubscriptionsOptions } from './common/subscriptions/websocket.js';

import type { Envelop } from '@envelop/types';
import type { EnvelopContext } from './common/types';
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
  prepare?: (appBuilder: BaseEnvelopBuilder) => void | Promise<void>;
}

export interface EnvelopAppBuilder extends BaseEnvelopBuilder {
  buildApp(options: BuildAppOptions): Promise<Router>;
}

export function CreateApp(config: EnvelopAppOptions = {}): EnvelopAppBuilder {
  const { appBuilder, ...commonApp } = createEnvelopAppFactory(config, {
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

        EnvelopApp.use(path, (req, res, next) => {
          const request = {
            body: req.body,
            headers: req.headers,
            method: req.method,
            query: req.query,
          };

          return handleRequest({
            request,
            getEnveloped,
            buildContextArgs() {
              return {
                request: req,
                response: res,
              };
            },
            buildContext,
            onResponse(result) {
              res.type('application/json');
              res.status(result.status);
              res.json(result.payload);
            },
            onMultiPartResponse(result, defaultHandle) {
              return defaultHandle(req, res, result);
            },
            onPushResponse(result, defaultHandle) {
              return defaultHandle(req, res, result);
            },
          }).catch(next);
        });

        await Promise.all([IDEPromise, subscriptionsPromise]);

        return EnvelopApp;
      },
    });
  }

  return {
    ...commonApp,
    buildApp,
  };
}

export { gql };

export * from './common/base.js';
export * from './common/LazyPromise/lazyPromise.js';
