import { getGraphQLParameters, processRequest } from 'graphql-helix';
import { gql } from 'graphql-modules';

import { CreateEnvelopAppFactory } from './common';
import { BaseEnvelopAppOptions } from './types';

import type { ExecutionContext } from 'graphql-helix/dist/types';
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import type { Server } from 'http';

export interface FastifyEnvelopApp {
  EnvelopAppPlugin: FastifyPluginCallback<Record<never, never>, Server>;
}

export interface FastifyEnvelopAppOptions extends BaseEnvelopAppOptions {
  /**
   * Build Context
   */
  buildContext?: (request: FastifyRequest, reply: FastifyReply) => Record<string, unknown> | Promise<Record<string, unknown>>;
}

export interface FastifyEnvelopContext {
  reply: FastifyReply;
}

export function CreateEnvelopApp(config: FastifyEnvelopAppOptions = {}) {
  const { appBuilder, gql, modules, registerModule } = CreateEnvelopAppFactory(config, {
    contextTypeName: 'FastifyEnvelopContext',
  });
  const { buildContext } = config;

  function buildApp(prepare?: undefined): FastifyEnvelopApp;
  function buildApp(prepare: () => Promise<void>): Promise<FastifyEnvelopApp>;
  function buildApp(prepare: () => void): FastifyEnvelopApp;
  function buildApp(prepare?: () => Promise<void> | void): FastifyEnvelopApp | Promise<FastifyEnvelopApp> {
    return appBuilder({
      prepare,
      adapterFactory(getEnveloped) {
        const EnvelopAppPlugin: FastifyPluginCallback = async function FastifyPlugin(instance, _opts) {
          const { default: AltairFastify } = await import('altair-fastify-plugin');

          instance.register(AltairFastify, {});

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
                  buildContext?.(req, reply),
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
              } else {
                // You can find a complete example with GraphQL Subscriptions and stream/defer here:
                // https://github.com/contrawork/graphql-helix/blob/master/examples/fastify/server.ts
                reply.send({ errors: [{ message: 'Not Supported in this demo' }] });
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
export * from './types';
