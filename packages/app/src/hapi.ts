import { gql } from 'graphql-modules';

import { BaseEnvelopAppOptions, BaseEnvelopBuilder, createEnvelopAppFactory, handleRequest } from './common/app.js';
import { handleIDE } from './common/ide/handle.js';
import { RawAltairHandler } from './common/ide/rawAltair.js';

import type { EnvelopContext, IDEOptions } from './common/types';
import type { Request, ResponseToolkit, Plugin, Server, Lifecycle } from '@hapi/hapi';

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

export interface EnvelopAppBuilder extends BaseEnvelopBuilder {
  buildApp(options: BuildAppOptions): Plugin<{}>;
}

export function CreateApp(config: EnvelopAppOptions = {}): EnvelopAppBuilder {
  const { appBuilder, ...commonApp } = createEnvelopAppFactory(config, {
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

              return handleRequest<BuildContextArgs, Lifecycle.ReturnValueTypes>({
                request,
                getEnveloped,
                buildContext,
                buildContextArgs() {
                  return {
                    request: req,
                    h,
                  };
                },
                onResponse(result) {
                  return h.response(result.payload).code(result.status).type('application/json');
                },
                async onMultiPartResponse(result, defaultHandle) {
                  await defaultHandle(req.raw.req, req.raw.res, result);

                  return h.abandon;
                },
                async onPushResponse(result, defaultHandle) {
                  await defaultHandle(req.raw.req, req.raw.res, result);

                  return h.abandon;
                },
              });
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
    ...commonApp,
    buildApp,
  };
}

export { gql };
export * from './common/base.js';
export * from './common/LazyPromise/lazyPromise.js';
