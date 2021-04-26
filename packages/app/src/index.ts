import { getGraphQLParameters, processRequest } from 'graphql-helix';
import { createApplication, createModule, gql, Module, ModuleConfig, TypeDefs } from 'graphql-modules';

import { envelop } from '@envelop/core';
import { useGraphQLModules } from '@envelop/graphql-modules';

import { DeepPartial } from './types';

import type { FastifyPluginCallback } from 'fastify';
import type { IncomingHttpHeaders, Server } from 'http';
import type { CodegenPluginsConfig } from './codegen';

export interface EnvelopResolvers {}

export type EnvelopModuleConfig = Omit<ModuleConfig, 'typeDefs' | 'id' | 'resolvers'> & {
  id?: string;
  resolvers?: EnvelopResolvers;
};

export interface Request {
  body?: any;
  headers: IncomingHttpHeaders;
  method: string;
  query: any;
}

export interface EnvelopApp {
  FastifyPlugin: FastifyPluginCallback<Record<never, never>, Server>;
}

export interface EnvelopAppOptions {
  /**
   * Allow deep partial type resolvers
   *
   * @default false
   */
  deepPartialResolvers?: boolean;
  /**
   * Add custom "graphql-codegen" config
   */
  codegenConfig?: CodegenPluginsConfig;
  /**
   * Generated target path
   *
   * @default "./src/envelop.generated.ts"
   */
  targetPath?: string;
  /**
   * Output schema target path or flag
   *
   * If `true`, defaults to `"schema.gql"`
   * You can specify a `.gql`, `.graphql` or `.json` extension
   *
   * @default false
   */
  outputSchema?: boolean | string;
}

export function CreateEnvelopApp(config: EnvelopAppOptions = {}) {
  let acumId = 0;

  let modules: Module[] = [];

  function registerModule(typeDefs: TypeDefs, { id, ...options }: EnvelopModuleConfig = {}) {
    id ||= ++acumId + '';
    const module = createModule({
      typeDefs,
      id,
      ...options,
    });

    modules.push(module);

    return module;
  }

  function buildApp(prepare?: undefined): EnvelopApp;
  function buildApp(prepare: () => Promise<void>): Promise<EnvelopApp>;
  function buildApp(prepare: () => void): EnvelopApp;
  function buildApp(prepare?: () => Promise<void> | void): EnvelopApp | Promise<EnvelopApp> {
    if (prepare) {
      const result = prepare();
      if (result instanceof Promise) {
        return result.then(getApp);
      }
    }

    return getApp();

    function getApp() {
      const GraphQLModulesApplication = createApplication({
        modules,
      });

      if (config.outputSchema) {
        import('./outputSchema').then(({ writeOutputSchema }) => {
          writeOutputSchema(GraphQLModulesApplication.schema, config.outputSchema!).catch(console.error);
        });
      }

      import('./codegen')
        .then(({ EnvelopCodegen }) => {
          EnvelopCodegen(GraphQLModulesApplication.schema, config).catch(console.error);
        })
        .catch(console.error);

      const getEnveloped = envelop({
        plugins: [useGraphQLModules(GraphQLModulesApplication)],
      });

      const FastifyPlugin: FastifyPluginCallback = async function FastifyPlugin(instance, _opts) {
        const { default: AltairFastify } = await import('altair-fastify-plugin');

        await instance.register(AltairFastify, {});

        instance.route({
          method: ['GET', 'POST'],
          url: '/graphql',
          async handler(req, res) {
            const { parse, validate, contextFactory, execute, schema, subscribe } = getEnveloped();

            const request: Request = {
              body: req.body,
              headers: req.headers,
              method: req.method,
              query: req.query,
            };

            const { operationName, query, variables } = getGraphQLParameters(req);

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
              res.status(result.status);
              res.send(result.payload);
            } else {
              // You can find a complete example with GraphQL Subscriptions and stream/defer here:
              // https://github.com/contrawork/graphql-helix/blob/master/examples/fastify/server.ts
              res.send({ errors: [{ message: 'Not Supported in this demo' }] });
            }
          },
        });
      };

      return {
        FastifyPlugin,
      };
    }
  }

  return {
    gql,
    registerModule,
    buildApp,
  };
}

export { gql, DeepPartial };
