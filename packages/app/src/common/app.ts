import { isSchema } from 'graphql';
import { Application, ApplicationConfig, createApplication, createModule, gql, Module, TypeDefs } from 'graphql-modules';

import { Envelop, envelop, useSchema } from '@envelop/core';
import { useGraphQLModules } from '@envelop/graphql-modules';
import { mergeSchemasAsync, MergeSchemasConfig } from '@graphql-tools/merge';
import { IExecutableSchemaDefinition, makeExecutableSchema } from '@graphql-tools/schema';

import { RegisterDataLoader, RegisterDataLoaderFactory } from './dataloader.js';
import { cleanObject } from './utils/object.js';

import type { ScalarsConfig } from './scalars';
import type { GraphQLSchema } from 'graphql';
import type { Plugin } from '@envelop/core';
import type { EnvelopContext, EnvelopModuleConfig, EnvelopResolvers } from './types';
import type { CodegenConfig } from './codegen/typescript';
import type { useGraphQlJit } from '@envelop/graphql-jit';

export type AdapterFactory<T> = (envelop: Envelop<unknown>, modulesApplication: Application) => T;

export interface InternalEnvelopConfig {
  moduleName: 'express' | 'fastify' | 'nextjs' | 'http' | 'koa' | 'hapi';
}

export interface InternalAppBuildOptions<T> {
  prepare?: () => void | Promise<void>;
  adapterFactory: AdapterFactory<T>;
}

export interface BaseEnvelopBuilder {
  registerModule: (typeDefs: TypeDefs, options?: EnvelopModuleConfig) => Module;
  registerDataLoader: RegisterDataLoader;
  gql: typeof gql;
  modules: Module[];
  plugins: Plugin[];
}

export interface EnvelopAppFactoryType extends BaseEnvelopBuilder {
  appBuilder<T>(opts: InternalAppBuildOptions<T>): Promise<T>;
}

export interface ExecutableSchemaDefinition<TContext = EnvelopContext>
  extends Omit<IExecutableSchemaDefinition<TContext>, 'resolvers'> {
  resolvers?: EnvelopResolvers<TContext> | EnvelopResolvers<TContext>[];
}

interface EnvelopOptions {
  plugins?: Plugin[];
}

export interface BaseEnvelopAppOptions<TContext> extends EnvelopOptions, Partial<ApplicationConfig> {
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

  /**
   * Enable JIT Compilation using [graphql-jit](https://github.com/zalando-incubator/graphql-jit)
   *
   * @default false
   */
  jit?: boolean | Parameters<typeof useGraphQlJit>;
}

export function createEnvelopAppFactory<TContext>(
  config: BaseEnvelopAppOptions<TContext>,
  internalConfig: InternalEnvelopConfig
): EnvelopAppFactoryType {
  const factoryModules = config.modules ? [...config.modules] : [];
  const factoryPlugins = config.plugins ? [...config.plugins] : [];

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
  const registerDataLoader = RegisterDataLoaderFactory(factoryPlugins);

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
      factoryPlugins.length = 0;
      if (config.modules) factoryModules.push(...config.modules);
      if (config.plugins) factoryPlugins.push(...config.plugins);
      acumId = 0;
    }

    async function getApp() {
      const modules = [...factoryModules];
      const plugins = [...factoryPlugins];

      const {
        enableCodegen = process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test',
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
        jit = false,
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

      if (modules.length) plugins.push(useGraphQLModules(modulesApplication));

      const jitPromise = jit
        ? import('@envelop/graphql-jit').then(({ useGraphQlJit }) => {
            plugins.push(typeof jit === 'object' ? useGraphQlJit(...jit) : useGraphQlJit());
          })
        : null;

      const schemaPromise = manualSchema
        ? (async () => {
            const schemas = (Array.isArray(manualSchema) ? manualSchema : [manualSchema]).map(schemaValue =>
              isSchema(schemaValue) ? schemaValue : makeExecutableSchema(schemaValue as IExecutableSchemaDefinition)
            );

            if (schemas.length > 1) {
              plugins.push(
                useSchema(
                  await mergeSchemasAsync({
                    ...cleanObject(mergeSchemasConfig),
                    schemas: [...(modules.length ? [modulesApplication.schema] : []), ...schemas],
                  })
                )
              );
            } else if (schemas[0]) {
              plugins.push(
                useSchema(
                  modules.length
                    ? await mergeSchemasAsync({
                        ...cleanObject(mergeSchemasConfig),
                        schemas: [modulesApplication.schema, schemas[0]],
                      })
                    : schemas[0]
                )
              );
            }
          })()
        : null;

      await Promise.all([jitPromise, schemaPromise]);

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
    registerDataLoader,
    appBuilder,
    gql,
    modules: factoryModules,
    plugins: factoryPlugins,
  };
}
