import { isSchema } from 'graphql';
import { Application, ApplicationConfig, createApplication, createModule, gql, Module, TypeDefs } from 'graphql-modules';

import { Envelop, envelop, useSchema } from '@envelop/core';
import { useGraphQLModules } from '@envelop/graphql-modules';
import { mergeSchemasAsync, MergeSchemasConfig } from '@graphql-tools/merge';
import { IExecutableSchemaDefinition, makeExecutableSchema } from '@graphql-tools/schema';

import type { ScalarsConfig } from './scalars';
import type { GraphQLSchema } from 'graphql';
import type { EnvelopOptions } from '@envelop/core';
import type { EnvelopContext, EnvelopModuleConfig, EnvelopResolvers } from './types';
import type { CodegenConfig } from './codegen/typescript';

export type AdapterFactory<T> = (envelop: Envelop<unknown>, modulesApplication: Application) => T;

export interface InternalEnvelopConfig {
  moduleName: 'express' | 'fastify' | 'nextjs';
}

export interface InternalAppBuildOptions<T> {
  prepare?: () => void | Promise<void>;
  adapterFactory: AdapterFactory<T>;
}

export interface EnvelopAppFactoryType {
  registerModule: (typeDefs: TypeDefs, options?: EnvelopModuleConfig) => Module;
  gql: typeof gql;
  appBuilder<T>(opts: InternalAppBuildOptions<T>): Promise<T>;
  modules: Module[];
}

export interface ExecutableSchemaDefinition<TContext = EnvelopContext>
  extends Omit<IExecutableSchemaDefinition<TContext>, 'resolvers'> {
  resolvers?: EnvelopResolvers<TContext> | EnvelopResolvers<TContext>[];
}

export interface BaseEnvelopAppOptions<TContext>
  extends Partial<Omit<EnvelopOptions, 'initialSchema' | 'extends'>>,
    Partial<ApplicationConfig> {
  /**
   * Pre-built schema
   */
  schema?: GraphQLSchema | ExecutableSchemaDefinition<TContext> | Array<GraphQLSchema | ExecutableSchemaDefinition<TContext>>;

  /**
   * Customize configuration of schema merging
   */
  mergeSchemasConfig?: Omit<MergeSchemasConfig, 'schemas'>;

  /**
   * Enable code generation, by default it's enabled if `NODE_ENV` is not `production` nor `test`
   *
   * @default process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test"
   */
  enableCodegen?: boolean;

  /**
   * Add custom codegen config
   */
  codegen?: CodegenConfig;

  /**
   * Output schema target path or flag
   *
   * If `true`, defaults to `"./schema.gql"`
   * You have to specify a `.gql`, `.graphql` or `.json` extension
   *
   * @default false
   */
  outputSchema?: boolean | string;

  /**
   * Add scalars
   */
  scalars?: ScalarsConfig;
}

export function createEnvelopAppFactory<TContext>(
  config: BaseEnvelopAppOptions<TContext>,
  internalConfig: InternalEnvelopConfig
): EnvelopAppFactoryType {
  const factoryModules = config.modules ? [...config.modules] : [];

  let acumId = 0;
  function registerModule(typeDefs: TypeDefs, { id, ...options }: EnvelopModuleConfig = {}) {
    id ||= `module${++acumId}`;
    const module = createModule({
      typeDefs,
      id,
      ...options,
    });

    factoryModules.push(module);

    return module;
  }

  async function appBuilder<T>({
    adapterFactory,
    prepare,
  }: {
    prepare?: () => Promise<void> | void;
    adapterFactory: AdapterFactory<T>;
  }): Promise<T> {
    try {
      if (prepare) await prepare();

      return getApp();
    } finally {
      factoryModules.length = 0;
      if (config.modules) factoryModules.push(...config.modules);
      acumId = 0;
    }

    async function getApp() {
      const modules = [...factoryModules];

      const {
        enableCodegen = process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test',
        plugins: manualPlugins = [],
        schema: manualSchema,
        middlewares,
        providers,
        schemaBuilder,
        scalars,
        codegen: {
          // eslint-disable-next-line no-console
          onError: onCodegenError = console.error,
        } = {},
        mergeSchemasConfig,
      } = config;

      if (scalars) {
        await import('./scalars.js').then(({ createScalarsModule }) => {
          const scalarsModule = createScalarsModule(scalars);

          if (scalarsModule) modules.push(scalarsModule);
        });
      }

      const modulesApplication = createApplication({
        modules,
        middlewares,
        providers,
        schemaBuilder,
      });

      const plugins = modules.length ? [useGraphQLModules(modulesApplication), ...manualPlugins] : [...manualPlugins];

      if (manualSchema) {
        const schemas = (Array.isArray(manualSchema) ? manualSchema : [manualSchema]).map(schemaValue =>
          isSchema(schemaValue) ? schemaValue : makeExecutableSchema(schemaValue as IExecutableSchemaDefinition)
        );

        if (schemas.length > 1) {
          plugins.push(
            useSchema(
              await mergeSchemasAsync({
                ...(mergeSchemasConfig || {}),
                schemas: [...(modules.length ? [modulesApplication.schema] : []), ...schemas],
              })
            )
          );
        } else if (schemas[0]) {
          plugins.push(
            useSchema(
              modules.length
                ? await mergeSchemasAsync({
                    ...(mergeSchemasConfig || {}),
                    schemas: [modulesApplication.schema, schemas[0]],
                  })
                : schemas[0]
            )
          );
        }
      }

      const getEnveloped = envelop({
        plugins,
      });

      if (enableCodegen) {
        import('./codegen/handle.js')
          .then(({ handleCodegen }) => {
            handleCodegen(getEnveloped, config, internalConfig);
          })
          .catch(onCodegenError);
      }

      return adapterFactory(getEnveloped, modulesApplication);
    }
  }

  return {
    registerModule,
    appBuilder,
    gql,
    modules: factoryModules,
  };
}
