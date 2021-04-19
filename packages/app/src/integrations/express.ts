import { getGraphQLParameters, processRequest } from 'graphql-helix';
import { gql, Module, TypeDefs } from 'graphql-modules';

import { createEnvelopAppFactory, BaseEnvelopAppOptions } from '../common/index.js';

import type { ExecutionContext } from 'graphql-helix/dist/types';
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import type { Server } from 'http';
import type { EnvelopModuleConfig } from '../common/types';

export interface ExpressEnvelopApp {
  EnvelopAppPlugin: FastifyPluginCallback<Record<never, never>, Server>;
}

export interface ExpressContextArgs {
  request: FastifyRequest;
  reply: FastifyReply;
}

export interface ExpressEnvelopAppOptions extends BaseEnvelopAppOptions {
  /**
   * Build Context
   */
  buildContext?: (args: ExpressContextArgs) => Record<string, unknown> | Promise<Record<string, unknown>>;
}

export interface ExpressEnvelopContext {
  reply: FastifyReply;
}

export interface ExpressEnvelopAppBuilder {
  gql: typeof gql;
  modules: Module[];
  registerModule: (typeDefs: TypeDefs, options?: EnvelopModuleConfig | undefined) => Module;
  buildApp: {
    (prepare?: undefined): ExpressEnvelopApp;
    (prepare: () => Promise<void>): Promise<ExpressEnvelopApp>;
    (prepare: () => void): ExpressEnvelopApp;
  };
}

export function CreateExpressApp(config: ExpressEnvelopAppOptions = {}): ExpressEnvelopAppBuilder {
  const { appBuilder, gql, modules, registerModule } = createEnvelopAppFactory(config, {
    contextTypeName: 'FastifyEnvelopContext',
  });
  const { buildContext } = config;

  function buildApp(prepare?: undefined): ExpressEnvelopApp;
  function buildApp(prepare: () => Promise<void>): Promise<ExpressEnvelopApp>;
  function buildApp(prepare: () => void): ExpressEnvelopApp;
  function buildApp(prepare?: () => Promise<void> | void): ExpressEnvelopApp | Promise<ExpressEnvelopApp> {
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
                  buildContext?.({ request: req, reply }),
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
