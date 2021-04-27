import { renderGraphiQL } from 'graphql-helix';
import { gql } from 'graphql-modules';
import querystring from 'querystring';

import { BaseEnvelopAppOptions, BaseEnvelopBuilder, createEnvelopAppFactory, handleRequest } from './common/app.js';
import { parseIDEConfig } from './common/ide/handle.js';
import { RawAltairHandler } from './common/ide/rawAltair.js';
import { getPathname } from './common/utils/url.js';

import type { RenderGraphiQLOptions } from 'graphql-helix/dist/types';
import type { EnvelopContext, IDEOptions } from './common/types';
import type { RenderOptions } from 'altair-static';
import type { IncomingMessage, ServerResponse } from 'http';

export interface BuildContextArgs {
  request: IncomingMessage;
  response: ServerResponse;
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
   * Handle Not Found
   *
   * @default true
   */
  handleNotFound?: boolean;
}

export interface BuildAppOptions {
  prepare?: (appBuilder: BaseEnvelopBuilder) => void | Promise<void>;
}

export type AsyncRequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;
export type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void;

export interface EnvelopAppBuilder extends BaseEnvelopBuilder {
  buildApp(options?: BuildAppOptions): AsyncRequestHandler;
}

export function CreateApp(config: EnvelopAppOptions = {}): EnvelopAppBuilder {
  const { appBuilder, ...commonApp } = createEnvelopAppFactory(config, {
    moduleName: 'http',
  });

  function buildApp({ prepare }: BuildAppOptions): AsyncRequestHandler {
    let app: AsyncRequestHandler | undefined;
    const { buildContext, path = '/graphql', ide = { altair: true, graphiql: true }, handleNotFound = true } = config;

    const appPromise = appBuilder({
      prepare,
      adapterFactory(getEnveloped): AsyncRequestHandler {
        const { altairOptions, graphiQLOptions, isAltairEnabled, isGraphiQLEnabled } = parseIDEConfig(ide, path);

        return async function (req, res) {
          const pathname = getPathname(req.url)!;

          if (pathname !== path) {
            if (isAltairEnabled && pathname.startsWith(altairOptions.path)) {
              return AltairHandler(altairOptions)(req, res);
            } else if (isGraphiQLEnabled && pathname === graphiQLOptions.path) {
              return GraphiQLHandler(graphiQLOptions)(req, res);
            }

            if (handleNotFound) return res.writeHead(404).end();

            return;
          }

          let payload = '';

          req.on('data', (chunk: Buffer) => {
            payload += chunk.toString('utf-8');
          });

          req.on('end', () => {
            const body = JSON.parse(payload || '{}');

            const urlQuery = req.url?.split('?')[1];

            const request = {
              body,
              headers: req.headers,
              method: req.method!,
              query: urlQuery ? querystring.parse(urlQuery) : {},
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
              onResponse(result, defaultHandle) {
                return defaultHandle(req, res, result);
              },
              onMultiPartResponse(result, defaultHandle) {
                return defaultHandle(req, res, result);
              },
              onPushResponse(result, defaultHandle) {
                return defaultHandle(req, res, result);
              },
            }).catch(err => {
              res
                .writeHead(500, {
                  'Content-Type': 'application/json',
                })
                .end(
                  JSON.stringify({
                    message: err.message,
                  })
                );
            });
          });
        };
      },
    });

    appPromise.then(handler => {
      app = handler;
    });

    return async function (req, res) {
      try {
        await (app || (await appPromise))(req, res);
      } catch (err) {
        res
          .writeHead(500, {
            'content-type': 'application/json',
          })
          .end(
            JSON.stringify({
              message: err.message,
            })
          );
      }
    };
  }

  return {
    ...commonApp,
    buildApp,
  };
}

export interface GraphiQLHandlerOptions extends RenderGraphiQLOptions {}

export function GraphiQLHandler(options: GraphiQLHandlerOptions = {}): RequestHandler {
  const { endpoint = '/graphql', ...renderOptions } = options;
  return function (req, res) {
    if (req.method !== 'GET') return res.writeHead(404).end();

    res.setHeader('content-type', 'text/html');

    res.end(renderGraphiQL({ ...renderOptions, endpoint }));
  };
}

export interface AltairHandlerOptions extends Omit<RenderOptions, 'baseURL'> {
  /**
   *  Request Path
   *
   * @default "/altair"
   */
  path?: string;
}

export function AltairHandler(options: AltairHandlerOptions = {}): AsyncRequestHandler {
  const { path = '/altair', endpointURL = '/graphql', ...renderOptions } = options;

  return RawAltairHandler({
    path,
    endpointURL,
    ...renderOptions,
  });
}

export { gql, getPathname };

export * from './common/base.js';
export * from './common/LazyPromise/lazyPromise.js';
