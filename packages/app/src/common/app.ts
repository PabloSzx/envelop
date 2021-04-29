import { extendSchema, isSchema } from 'graphql';
import { Application, ApplicationConfig, createApplication, createModule, gql, Module, TypeDefs } from 'graphql-modules';

import { Envelop, envelop, Plugin, useSchema } from '@envelop/core';
import { useGraphQLModules } from '@envelop/graphql-modules';
import { mergeSchemasAsync, MergeSchemasConfig } from '@graphql-tools/merge';
import { IExecutableSchemaDefinition, makeExecutableSchema } from '@graphql-tools/schema';

import { RegisterDataLoader, RegisterDataLoaderFactory } from './dataloader.js';
import { createScalarsModule, ScalarsConfig, ScalarsModule } from './scalars.js';
import { cleanObject } from './utils/object.js';

import type { GraphQLSchema } from 'graphql';
import type { EnvelopContext, EnvelopModuleConfig, EnvelopResolvers } from './types';
import type { CodegenConfig } from './codegen/typescript';
import type { useGraphQlJit } from '@envelop/graphql-jit';
import type { handleRequest } from './request';

export type AdapterFactory<T> = (envelop: Envelop<unknown>, modulesApplication: Application) => T;

export interface InternalEnvelopConfig {
  moduleName: 'express' | 'fastify' | 'nextjs' | 'http' | 'koa' | 'hapi';
}

export interface BaseEnvelopBuilder {
  registerModule: (typeDefs: TypeDefs, options?: EnvelopModuleConfig) => Module;
  registerDataLoader: RegisterDataLoader;
  gql: typeof gql;
  modules: Module[];
  plugins: Plugin[];
  /**
   * Created scalars module, you might only use this for GraphQL Modules testing purposes
   *
   * Further information {@link https://www.graphql-modules.com/docs/essentials/testing/}
   */
  scalarsModule: ScalarsModule | null;
}

export interface InternalAppBuildOptions<T> {
  prepare?: (appBuilder: BaseEnvelopBuilder) => void | Promise<void>;
  adapterFactory: AdapterFactory<T>;
}

export interface EnvelopAppFactoryType extends BaseEnvelopBuilder {
  appBuilder<T>(
    opts: InternalAppBuildOptions<T>
  ): Promise<{
    app: T;
    envelop: Envelop<unknown>;
  }>;
}

export interface ExecutableSchemaDefinition<TContext = EnvelopContext>
  extends Omit<IExecutableSchemaDefinition<TContext>, 'resolvers'> {
  resolvers?: EnvelopResolvers<TContext> | EnvelopResolvers<TContext>[];
}

export interface BaseEnvelopAppOptions<TContext> extends Partial<ApplicationConfig> {
  plugins?: Plugin[];
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

  /**
   * **Advanced usage only**
   *
   * Override `handleRequest` logic
   */
  customHandleRequest?: typeof handleRequest;
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

  const scalarsModule = createScalarsModule(config.scalars);

  async function appBuilder<T>({
    adapterFactory,
    prepare,
  }: {
    prepare?: (appBuilder: BaseEnvelopBuilder) => Promise<void> | void;
    adapterFactory: AdapterFactory<T>;
  }): Promise<{
    app: T;
    envelop: Envelop<unknown>;
  }> {
    try {
      if (prepare) await prepare(baseAppBuilder);

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
        codegen: {
          // eslint-disable-next-line no-console
          onError: onCodegenError = console.error,
        } = {},
        mergeSchemasConfig,
        jit = false,
      } = config;

      if (scalarsModule?.module) modules.push(scalarsModule.module);

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
              isSchema(schemaValue)
                ? scalarsModule?.typeDefs
                  ? extendSchema(schemaValue, scalarsModule.typeDefs)
                  : schemaValue
                : makeExecutableSchema({
                    ...schemaValue,
                    typeDefs: scalarsModule?.typeDefs
                      ? Array.isArray(schemaValue.typeDefs)
                        ? [...schemaValue.typeDefs, scalarsModule.typeDefs]
                        : [schemaValue.typeDefs, scalarsModule.typeDefs]
                      : schemaValue.typeDefs,
                  })
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

      return {
        app: adapterFactory(getEnveloped, modulesApplication),
        envelop: getEnveloped,
      };
    }
  }

  const baseAppBuilder: BaseEnvelopBuilder = {
    registerModule,
    registerDataLoader,
    gql,
    modules: factoryModules,
    plugins: factoryPlugins,
    scalarsModule,
  };

  return { ...baseAppBuilder, appBuilder };
}

export * from './request.js';
