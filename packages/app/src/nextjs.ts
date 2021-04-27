import { renderGraphiQL } from 'graphql-helix';
import { gql } from 'graphql-modules';

import { BaseEnvelopAppOptions, BaseEnvelopBuilder, createEnvelopAppFactory, handleRequest } from './common/app.js';
import { LazyPromise } from './common/LazyPromise/lazyPromise.js';

import type { RenderGraphiQLOptions } from 'graphql-helix/dist/types';
import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import type { EnvelopContext } from './common/types';
import type { RenderOptions } from 'altair-static';

export interface BuildContextArgs {
  request: NextApiRequest;
  response: NextApiResponse;
}

export interface EnvelopAppOptions extends BaseEnvelopAppOptions<EnvelopContext> {
  /**
   * Build Context
   */
  buildContext?: (args: BuildContextArgs) => Record<string, unknown> | Promise<Record<string, unknown>>;
}

export interface BuildAppOptions {
  prepare?: (appBuilder: BaseEnvelopBuilder) => void | Promise<void>;
}

export interface EnvelopAppBuilder extends BaseEnvelopBuilder {
  buildApp(options?: BuildAppOptions): NextApiHandler<unknown>;
}

export function CreateApp(config: EnvelopAppOptions = {}): EnvelopAppBuilder {
  const { appBuilder, ...commonApp } = createEnvelopAppFactory(config, {
    moduleName: 'nextjs',
  });

  function buildApp({ prepare }: BuildAppOptions = {}): NextApiHandler<unknown> {
    let app: NextApiHandler<unknown> | undefined;
    const { buildContext, customHandleRequest } = config;

    const appPromise = appBuilder({
      prepare,
      adapterFactory(getEnveloped): NextApiHandler<unknown> {
        const requestHandler = customHandleRequest || handleRequest;

        return (req, res) => {
          const request = {
            body: req.body,
            headers: req.headers,
            method: req.method!,
            query: req.query,
          };

          return requestHandler({
            request,
            getEnveloped,
            buildContext,
            buildContextArgs() {
              return {
                request: req,
                response: res,
              };
            },
            onResponse(result) {
              res.status(result.status).json(result.payload);
            },
            onMultiPartResponse(result, defaultHandle) {
              return defaultHandle(req, res, result);
            },
            onPushResponse(result, defaultHandle) {
              return defaultHandle(req, res, result);
            },
          });
        };
      },
    });

    appPromise.then(handler => {
      app = handler;
    });

    return async function (req, res) {
      await (app || (await appPromise))(req, res);
    };
  }

  return {
    ...commonApp,
    buildApp,
  };
}

export interface GraphiQLHandlerOptions extends RenderGraphiQLOptions {
  /**
   * The endpoint requests should be sent. Defaults to `"/api/graphql"`.
   */
  endpoint?: string;
}

export function GraphiQLHandler(options: GraphiQLHandlerOptions = {}): NextApiHandler<unknown> {
  const { endpoint = '/api/graphql', ...renderOptions } = options;

  const html = renderGraphiQL({ ...renderOptions, endpoint });
  return function (req, res) {
    if (req.method !== 'GET') return res.status(404).end();

    res.setHeader('content-type', 'text/html');
    res.send(html);
  };
}

export interface AltairHandlerOptions extends Omit<RenderOptions, 'baseURL'> {
  /**
   *  Request Path
   *
   * @default "/api/altair"
   */
  path?: string;

  /**
   * URL to set as the server endpoint
   *
   * @default "/api/graphql"
   */
  endpointURL?: string;
}

export function AltairHandler(options: AltairHandlerOptions = {}): NextApiHandler<unknown> {
  let { path = '/api/altair', endpointURL = '/api/graphql', ...renderOptions } = options;

  const baseURL = path.endsWith('/') ? (path = path.slice(0, path.length - 1)) + '/' : path + '/';

  const deps = LazyPromise(async () => {
    const [
      { getDistDirectory, renderAltair },
      {
        promises: { readFile },
      },
      { resolve },
      { lookup },
    ] = await Promise.all([import('altair-static'), import('fs'), import('path'), import('mime-types')]);

    return {
      getDistDirectory,
      renderAltair,
      readFile,
      resolve,
      lookup,
    };
  });

  return async function (req, res) {
    const { renderAltair, getDistDirectory, readFile, resolve, lookup } = await deps;
    switch (req.url) {
      case path:
      case baseURL: {
        res.setHeader('content-type', 'text/html');
        res.send(
          renderAltair({
            ...renderOptions,
            baseURL,
            endpointURL,
          })
        );
        return;
      }
      case undefined: {
        return res.status(404).end();
      }
      default: {
        const resolvedPath = resolve(getDistDirectory(), req.url.slice(baseURL.length));

        const result = await readFile(resolvedPath).catch(() => {});

        if (!result) return res.status(404).end();

        const contentType = lookup(resolvedPath);
        if (contentType) res.setHeader('content-type', contentType);
        res.end(result);
      }
    }
  };
}

export { gql };

export * from './common/base.js';
export * from './common/LazyPromise/lazyPromise.js';