import { getGraphQLParameters, processRequest } from 'graphql-helix';
import { gql, Module, TypeDefs } from 'graphql-modules';
import bodyParser from 'koa-bodyparser';

import { BaseEnvelopAppOptions, createEnvelopAppFactory } from './common/app.js';
import { handleIDE } from './common/ide.js';

import type * as KoaRouter from '@koa/router';
import type { ExecutionContext } from 'graphql-helix/dist/types';
import type { EnvelopModuleConfig, EnvelopContext, IDEOptions } from './common/types';
import type { Request, Response } from 'koa';

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
   * To enable [`Altair`](https://altair.sirmuel.design/) you will need to install `altair-koa-middleware`
   * @see [https://npm.im/altair-koa-middleware](https://npm.im/altair-koa-middleware)
   *
   * @default { altair: false, graphiql: true }
   */
  ide?: IDEOptions;

  /**
   * [koa-bodyparser](http://npm.im/koa-bodyparser) options
   */
  bodyParserOptions?: bodyParser.Options | false;
}

export interface BuildAppOptions {
  prepare?: () => void | Promise<void>;
  /**
   * Koa Router instance
   *
   * @see [https://npm.im/@koa/router](https://npm.im/@koa/router)
   */
  router: KoaRouter;
}

export interface EnvelopAppBuilder {
  gql: typeof gql;
  modules: Module[];
  registerModule: (typeDefs: TypeDefs, options?: EnvelopModuleConfig | undefined) => Module;
  buildApp(options: BuildAppOptions): Promise<void>;
}

export function CreateApp(config: EnvelopAppOptions = {}): EnvelopAppBuilder {
  const { appBuilder, gql, modules, registerModule } = createEnvelopAppFactory(config, {
    moduleName: 'koa',
  });

  async function buildApp({ router, prepare }: BuildAppOptions): Promise<void> {
    const { path = '/graphql', buildContext, ide, bodyParserOptions = {} } = config;

    return appBuilder({
      prepare,
      async adapterFactory(getEnveloped): Promise<void> {
        if (bodyParserOptions) router.use(bodyParser(bodyParserOptions));

        await handleIDE(
          ide,
          path,
          {
            async handleAltair({ path: idePath, ...opts }) {
              const { createRouteExplorer } = await import('altair-koa-middleware');

              createRouteExplorer({
                router,
                url: idePath,
                opts,
              });
            },
            handleGraphiQL({ path, html }) {
              router.get(path, ctx => {
                ctx.type = 'html';
                ctx.body = html;
              });
            },
          },
          'graphiql'
        );

        const main: KoaRouter.Middleware = async ctx => {
          const request = {
            body: ctx.request.body,
            headers: ctx.request.headers,
            method: ctx.request.method,
            query: ctx.request.query,
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
                    request: ctx.request,
                    response: ctx.response,
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
            ctx.type = 'application/json';
            ctx.response.status = result.status;
            ctx.response.body = result.payload;
          } else if (result.type === 'MULTIPART_RESPONSE') {
            ctx.res.writeHead(200, {
              Connection: 'keep-alive',
              'Content-Type': 'multipart/mixed; boundary="-"',
              'Transfer-Encoding': 'chunked',
              'Content-Encoding': 'none',
            });

            ctx.req.on('close', () => {
              result.unsubscribe();
            });

            ctx.res.write('---');

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

              ctx.res.write(data.join('\r\n'));
            });

            ctx.res.write('\r\n-----\r\n');
            ctx.res.end();
          } else {
            ctx.res.writeHead(200, {
              'Content-Encoding': 'none',
              'Content-Type': 'text/event-stream',
              Connection: 'keep-alive',
              'Cache-Control': 'no-cache',
            });

            ctx.req.on('close', () => {
              result.unsubscribe();
            });

            await result.subscribe(result => {
              ctx.res.write(`data: ${JSON.stringify(result)}\n\n`);
            });
          }
        };
        router.get(path, main).post(path, main);
      },
    });
  }

  return {
    buildApp,
    gql,
    modules,
    registerModule,
  };
}

export { gql };

export * from './common/types.js';
export * from './common/LazyPromise/lazyPromise.js';
