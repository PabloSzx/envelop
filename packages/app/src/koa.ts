import { gql } from 'graphql-modules';
import bodyParser from 'koa-bodyparser';

import { BaseEnvelopAppOptions, BaseEnvelopBuilder, createEnvelopAppFactory, handleRequest } from './common/app.js';
import { handleIDE } from './common/ide/handle.js';
import { RawAltairHandlerDeps } from './common/ide/rawAltair.js';

import type * as KoaRouter from '@koa/router';
import type { EnvelopContext, IDEOptions } from './common/types';
import type { ParameterizedContext, Request, Response } from 'koa';

export interface BuildContextArgs {
  request: Request;
  response: Response;
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

  /**
   * [koa-bodyparser](http://npm.im/koa-bodyparser) options
   */
  bodyParserOptions?: bodyParser.Options | false;
}

export interface BuildAppOptions {
  prepare?: (appBuilder: BaseEnvelopBuilder) => void | Promise<void>;
  /**
   * Koa Router instance
   *
   * @see [https://npm.im/@koa/router](https://npm.im/@koa/router)
   */
  router: KoaRouter;
}

export interface EnvelopAppBuilder extends BaseEnvelopBuilder {
  buildApp(options: BuildAppOptions): Promise<void>;
}

export function CreateApp(config: EnvelopAppOptions = {}): EnvelopAppBuilder {
  const { appBuilder, ...commonApp } = createEnvelopAppFactory(config, {
    moduleName: 'koa',
  });

  async function buildApp({ router, prepare }: BuildAppOptions): Promise<void> {
    const { path = '/graphql', buildContext, ide, bodyParserOptions = {}, customHandleRequest } = config;

    return appBuilder({
      prepare,
      async adapterFactory(getEnveloped): Promise<void> {
        if (bodyParserOptions) router.use(bodyParser(bodyParserOptions));

        await handleIDE(ide, path, {
          async handleAltair(ideOptions) {
            const { path, baseURL, renderOptions, deps } = RawAltairHandlerDeps(ideOptions);

            async function altairHandler(
              ctx: ParameterizedContext<any, KoaRouter.RouterParamContext<any, {}>, any>
            ): Promise<unknown> {
              const { renderAltair, getDistDirectory, readFile, resolve, lookup } = await deps;

              switch (ctx.url) {
                case path:
                case baseURL: {
                  ctx.type = 'html';

                  ctx.body = renderAltair({
                    ...renderOptions,
                    baseURL,
                  });
                  return;
                }
                case undefined: {
                  ctx.status = 404;
                  return;
                }
                default: {
                  const resolvedPath = resolve(getDistDirectory(), ctx.url.slice(baseURL.length));

                  const result = await readFile(resolvedPath).catch(() => {});

                  if (!result) return (ctx.status = 404);

                  const contentType = lookup(resolvedPath);
                  if (contentType) ctx.type = contentType;
                  return (ctx.body = result);
                }
              }
            }

            const basePath = path.endsWith('/') ? path.slice(0, path.length - 1) : path;

            router.get([basePath, basePath + '/(.*)'], async ctx => {
              await altairHandler(ctx);
            });
          },
          handleGraphiQL({ path, html }) {
            router.get(path, ctx => {
              ctx.type = 'html';
              ctx.body = html;
            });
          },
        });

        const requestHandler = customHandleRequest || handleRequest;

        const main: KoaRouter.Middleware = ctx => {
          const request = {
            body: ctx.request.body,
            headers: ctx.request.headers,
            method: ctx.request.method,
            query: ctx.request.query,
          };

          return requestHandler({
            request,
            buildContext,
            buildContextArgs() {
              return {
                request: ctx.request,
                response: ctx.response,
              };
            },
            getEnveloped,
            onResponse(result) {
              ctx.type = 'application/json';
              ctx.response.status = result.status;
              ctx.response.body = result.payload;
            },
            onMultiPartResponse(result, defaultHandle) {
              return defaultHandle(ctx.req, ctx.res, result);
            },
            onPushResponse(result, defaultHandle) {
              return defaultHandle(ctx.req, ctx.res, result);
            },
          });
        };
        router.get(path, main).post(path, main);
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