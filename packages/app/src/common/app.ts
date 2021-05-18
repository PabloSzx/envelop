import { Application, ApplicationConfig, createApplication, gql, Module } from 'graphql-modules';

import { Envelop, envelop, Plugin } from '@envelop/core';
import { useGraphQLModules } from '@envelop/graphql-modules';

import { CachePlugins, CacheOptions } from './cache.js';
import { RegisterDataLoader, RegisterDataLoaderFactory } from './dataloader.js';
import { RegisterModule, RegisterModuleFactory } from './modules.js';
import { createScalarsModule, ScalarsConfig, ScalarsModule } from './scalars.js';
import { SchemaBuilderFactory } from './schema.js';
import { uniqueArray } from './utils/object.js';

import type { GraphQLSchema } from 'graphql';
import type { EnvelopContext, EnvelopResolvers, GraphQLUploadConfig } from './types';
import type { CodegenConfig } from './codegen/typescript';
import type { useGraphQlJit } from '@envelop/graphql-jit';
import type { handleRequest } from './request';
import type { IExecutableSchemaDefinition } from '@graphql-tools/schema';
import type { MergeSchemasConfig } from '@graphql-tools/merge';

export type AdapterFactory<T> = (envelop: Envelop<unknown>, modulesApplication: Application) => T;

export interface InternalEnvelopConfig {
  moduleName: 'express' | 'fastify' | 'nextjs' | 'http' | 'koa' | 'hapi';
}

export interface BaseEnvelopBuilder {
  /**
   * Create and/or Register a GraphQL Module
   */
  registerModule: RegisterModule;
  /**
   * Create and Register a DataLoader
   */
  registerDataLoader: RegisterDataLoader;
  /**
   * GraphQL Tag Parser
   */
  gql: typeof gql;
  /**
   * List of custom GraphQL Modules
   */
  modules: Module[];
  /**
   * List of custom Envelop Plugins
   */
  plugins: Plugin[];
  /**
   * Created scalars module, you might only use this for GraphQL Modules testing purposes
   *
   * Further information {@link https://www.graphql-modules.com/docs/essentials/testing/}
   */
  scalarsModulePromise: Promise<ScalarsModule | null>;
}

export interface InternalAppBuildOptions<T> {
  prepare?: (appBuilder: BaseEnvelopBuilder) => void | Promise<void>;
  adapterFactory: AdapterFactory<T>;
}

export interface BuiltApp<T> {
  app: T;
  getEnveloped: Envelop<unknown>;
}

export interface EnvelopAppFactoryType extends BaseEnvelopBuilder {
  appBuilder<T>(opts: InternalAppBuildOptions<T>): Promise<BuiltApp<T>>;
}

export interface ExecutableSchemaDefinition<TContext = EnvelopContext>
  extends Omit<IExecutableSchemaDefinition<TContext>, 'resolvers'> {
  resolvers?: EnvelopResolvers | EnvelopResolvers[];
}

export type FilteredMergeSchemasConfig = Omit<MergeSchemasConfig, 'schemas'>;

export type SchemaDefinition<TContext = EnvelopContext> =
  | GraphQLSchema
  | Promise<GraphQLSchema>
  | ExecutableSchemaDefinition<TContext>
  | Promise<ExecutableSchemaDefinition<TContext>>;

export interface BaseEnvelopAppOptions<TContext> extends Partial<ApplicationConfig> {
  plugins?: Plugin[];
  /**
   * Pre-built schemas
   */
  schema?: SchemaDefinition<TContext> | SchemaDefinition<TContext>[];

  /**
   * Customize configuration of schema merging
   */
  mergeSchemasConfig?: FilteredMergeSchemasConfig;

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

  /**
   * Enable/Disable/Customize in-memory cache that improves performance
   *
   * `cache === true` => Enable both parse & validation cache
   *
   * `cache === false` => Disable caching
   *
   * @default true
   */
  cache?: CacheOptions;

  /**
   * **Advanced usage only**
   *
   * Override `handleRequest` logic
   */
  customHandleRequest?: typeof handleRequest;

  /**
   * Allow batched queries
   *
   * > Specify a number to set the maximum (inclusive) amount of batched queries allowed
   *
   * @default false
   */
  allowBatchedQueries?: boolean | number;
}

export interface BaseEnvelopAppOptionsWithUpload<TContext> extends BaseEnvelopAppOptions<TContext> {
  /**
   * Enable __GraphQL Upload__ support
   *
   * @see [https://github.com/jaydenseric/graphql-upload](https://github.com/jaydenseric/graphql-upload)
   *
   * When enabled, please make sure to install in your project: `graphql-upload` and `@types/graphql-upload`
   *
   * @default false
   */
  GraphQLUpload?: GraphQLUploadConfig;
}

export function createEnvelopAppFactory<TContext>(
  config: BaseEnvelopAppOptions<TContext>,
  internalConfig: InternalEnvelopConfig
): EnvelopAppFactoryType {
  const { mergeSchemasConfig } = config;
  const factoryModules = uniqueArray(config.modules);
  const factoryPlugins = uniqueArray(config.plugins);

  const { registerModuleState, registerModule } = RegisterModuleFactory(factoryModules);

  const registerDataLoader = RegisterDataLoaderFactory(factoryPlugins);

  const scalarsModulePromise = createScalarsModule(config.scalars, config);

  const prepareSchema = SchemaBuilderFactory({
    scalarsModulePromise,
    mergeSchemasConfig,
  });

  async function appBuilder<T>({
    adapterFactory,
    prepare,
  }: {
    prepare?: (appBuilder: BaseEnvelopBuilder) => Promise<void> | void;
    adapterFactory: AdapterFactory<T>;
  }): Promise<BuiltApp<T>> {
    try {
      if (prepare) await prepare(baseAppBuilder);

      return getApp();
    } finally {
      factoryModules.length = 0;
      factoryPlugins.length = 0;
      if (config.modules) factoryModules.push(...config.modules);
      if (config.plugins) factoryPlugins.push(...config.plugins);
      registerModuleState.acumId = 0;
    }

    async function getApp() {
      const appModules = uniqueArray(factoryModules);
      const appPlugins = uniqueArray(factoryPlugins);

      const {
        enableCodegen = process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test',
        schema,
        middlewares,
        providers,
        schemaBuilder,
        codegen: {
          // eslint-disable-next-line no-console
          onError: onCodegenError = console.error,
          onFinish,
        } = {},
        jit = false,
        cache = true,
      } = config;

      const scalarsModule = await scalarsModulePromise;

      if (scalarsModule?.module && appModules.length) appModules.push(scalarsModule.module);

      const modulesApplication = createApplication({
        modules: uniqueArray(appModules),
        middlewares,
        providers,
        schemaBuilder,
      });

      if (appModules.length) appPlugins.push(useGraphQLModules(modulesApplication));

      const cachePromise = CachePlugins(cache, appPlugins);

      const jitPromise = jit
        ? import('@envelop/graphql-jit').then(({ useGraphQlJit }) => {
            appPlugins.push(typeof jit === 'object' ? useGraphQlJit(...jit) : useGraphQlJit());
          })
        : null;

      const schemaPromise = schema
        ? prepareSchema({
            appModules,
            appPlugins,
            schema,
            modulesApplication,
          })
        : null;

      await Promise.all([jitPromise, schemaPromise, cachePromise]);

      const getEnveloped = envelop({
        plugins: uniqueArray(appPlugins),
      });

      if (enableCodegen) {
        import('./codegen/handle.js')
          .then(({ handleCodegen }) => {
            handleCodegen(getEnveloped, config, internalConfig);
          })
          .catch(onCodegenError);
      } else if (onFinish) {
        onFinish();
      }

      return {
        app: adapterFactory(getEnveloped, modulesApplication),
        getEnveloped,
      };
    }
  }

  const baseAppBuilder: BaseEnvelopBuilder = {
    registerModule,
    registerDataLoader,
    gql,
    modules: factoryModules,
    plugins: factoryPlugins,
    scalarsModulePromise,
  };

  return { ...baseAppBuilder, appBuilder };
}

export * from './request.js';
