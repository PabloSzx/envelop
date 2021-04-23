import { getGraphQLParameters, processRequest } from 'graphql-helix';
import { ExecutionContext } from 'graphql-helix/dist/types';
import { gql, Module, TypeDefs } from 'graphql-modules';

import { BaseEnvelopAppOptions, createEnvelopAppFactory } from '../common/index.js';

import type { Request, Response, Router } from 'express';
import type { EnvelopModuleConfig } from '../common/types';
export interface ExpressEnvelopApp {
  EnvelopAppRouter: Router;
}

export interface ExpressContextArgs {
  request: Request;
  response: Response;
}

export interface ExpressEnvelopAppOptions extends BaseEnvelopAppOptions {
  /**
   * Build Context
   */
  buildContext?: (args: ExpressContextArgs) => Record<string, unknown> | Promise<Record<string, unknown>>;
}

export interface ExpressEnvelopContext {
  request: Request;
  response: Response;
}

export interface ExpressEnvelopAppBuilder {
  gql: typeof gql;
  modules: Module[];
  registerModule: (typeDefs: TypeDefs, options?: EnvelopModuleConfig | undefined) => Module;
  buildApp(prepare: () => void | Promise<void>): Promise<ExpressEnvelopApp>;
}

export function CreateExpressApp(config: ExpressEnvelopAppOptions = {}): ExpressEnvelopAppBuilder {
  const { appBuilder, gql, modules, registerModule } = createEnvelopAppFactory(config, {
    contextTypeName: 'ExpressEnvelopContext',
  });

  const { buildContext, path = '/graphql' } = config;

  async function buildApp(prepare?: () => void | Promise<void>): Promise<ExpressEnvelopApp> {
    return appBuilder({
      prepare,
      async adapterFactory(getEnveloped) {
        const { Router, json } = await import('express');

        const EnvelopAppRouter = Router();

        EnvelopAppRouter.use(json());

        const { altairExpress } = await import('altair-express-middleware');

        EnvelopAppRouter.use(
          '/altair',
          altairExpress({
            endpointURL: path,
            subscriptionsEndpoint: `ws://localhost:3000/${path}`,
          })
        );

        EnvelopAppRouter.use(path, async (req, res) => {
          const request = {
            body: req.body,
            headers: req.headers,
            method: req.method,
            query: req.query,
          };

          const { operationName, query, variables } = getGraphQLParameters(request);

          const { parse, validate, contextFactory: contextFactoryEnvelop, execute, schema, subscribe } = getEnveloped();

          const contextFactory = async (helixCtx: ExecutionContext) => {
            const [envelopCtx, customCtx] = await Promise.all([
              contextFactoryEnvelop({ response: res, ...helixCtx }),
              buildContext?.({ request: req, response: res }),
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
            contextFactory,
            execute,
            subscribe,
          });

          if (result.type === 'RESPONSE') {
            result.headers.forEach(({ name, value }) => res.setHeader(name, value));
            res.status(result.status);
            res.json(result.payload);
          } else if (result.type === 'MULTIPART_RESPONSE') {
            res.writeHead(200, {
              Connection: 'keep-alive',
              'Content-Type': 'multipart/mixed; boundary="-"',
              'Transfer-Encoding': 'chunked',
            });

            req.on('close', () => {
              result.unsubscribe();
            });

            res.write('---');

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

              res.write(data.join('\r\n'));
            });

            res.write('\r\n-----\r\n');
            res.end();
          } else {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              Connection: 'keep-alive',
              'Cache-Control': 'no-cache',
            });

            req.on('close', () => {
              result.unsubscribe();
            });

            await result.subscribe(result => {
              res.write(`data: ${JSON.stringify(result)}\n\n`);
            });
          }
        });

        return {
          EnvelopAppRouter,
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
