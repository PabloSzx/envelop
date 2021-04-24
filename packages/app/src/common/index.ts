import { Application, ApplicationConfig, createApplication, createModule, gql, Module, TypeDefs } from 'graphql-modules';
import { resolvers as scalarResolvers, typeDefs as scalarTypeDefs } from 'graphql-scalars';

import { Envelop, envelop, useSchema } from '@envelop/core';
import { useGraphQLModules } from '@envelop/graphql-modules';

import type { GraphQLScalarType, GraphQLSchema } from 'graphql';
import type { EnvelopOptions } from '@envelop/core';

import type { EnvelopModuleConfig } from './types';
import type { CodegenConfig } from './codegen';

export type AdapterFactory<T> = (envelop: Envelop<unknown>, modulesApplication: Application) => T;

export interface InternalEnvelopConfig {
  contextTypeName: string;
}

export interface EnvelopAppFactoryType {
  registerModule: (typeDefs: TypeDefs, options?: EnvelopModuleConfig) => Module;
  gql: typeof gql;
  appBuilder<T>(opts: { prepare?: () => void | Promise<void>; adapterFactory: AdapterFactory<T> }): T;
  modules: Module[];
}

export interface BaseEnvelopAppOptions
  extends Partial<Omit<EnvelopOptions, 'initialSchema'>>,
    Partial<Omit<ApplicationConfig, 'modules'>> {
  /**
   * Pre-built schema
   */
  schema?: GraphQLSchema;

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
   * You can specify a `.gql`, `.graphql` or `.json` extension
   *
   * @default false
   */
  outputSchema?: boolean | string;
  /**
   * Add scalars
   */
  scalars?: '*' | { [k in keyof typeof scalarResolvers]?: boolean };
}

export function createEnvelopAppFactory(
  config: BaseEnvelopAppOptions,
  internalConfig: InternalEnvelopConfig
): EnvelopAppFactoryType {
  const modules: Module[] = [];
  let acumId = 0;

  const {
    scalars,
    codegen: {
      // eslint-disable-next-line no-console
      onError: onCodegenError = console.error,
    } = {},
  } = config;

  if (scalars) {
    if (scalars === '*') {
      const allScalarsNames = scalarTypeDefs.join('\n');
      modules.push(
        createModule({
          id: 'scalars',
          typeDefs: gql(allScalarsNames),
          resolvers: scalarResolvers,
        })
      );
    } else {
      const scalarNames = Object.entries(scalars).reduce((acum, [name, value]) => {
        if (value && name in scalarResolvers) acum.push(`scalar ${name}\n`);
        return acum;
      }, [] as string[]);
      if (scalarNames.length) {
        modules.push(
          createModule({
            id: 'scalars',
            typeDefs: gql(scalarNames),
            resolvers: Object.keys(scalars).reduce((acum, scalarName) => {
              const resolver = (scalarResolvers as Record<string, GraphQLScalarType>)[scalarName];

              if (resolver) acum[scalarName] = resolver;
              return acum;
            }, {} as Record<string, any>),
          })
        );
      }
    }
  }

  function registerModule(typeDefs: TypeDefs, { id, ...options }: EnvelopModuleConfig = {}) {
    id ||= `module${++acumId}`;
    const module = createModule({
      typeDefs,
      id,
      ...options,
    });

    modules.push(module);

    return module;
  }

  function appBuilder<T>(opts: { prepare?: undefined; adapterFactory: AdapterFactory<T> }): T;
  function appBuilder<T>(opts: { prepare: () => Promise<void>; adapterFactory: AdapterFactory<T> }): Promise<T>;
  function appBuilder<T>(opts: { prepare?: () => void; adapterFactory: AdapterFactory<T> }): T;
  function appBuilder<T>({
    adapterFactory,
    prepare,
  }: {
    prepare?: () => Promise<void> | void;
    adapterFactory: AdapterFactory<T>;
  }): T | Promise<T> {
    if (prepare) {
      const result = prepare();
      if (result instanceof Promise) {
        return result.then(getApp);
      }
    }

    return getApp();

    function getApp() {
      const {
        outputSchema,
        enableCodegen = process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test',
        plugins = [],
        schema: initialSchema,
        extends: envelopExtends,
        middlewares,
        providers,
        schemaBuilder,
      } = config;

      const modulesApplication = createApplication({
        modules,
        middlewares,
        providers,
        schemaBuilder,
      });

      const envelopPlugins = modules.length ? [useGraphQLModules(modulesApplication), ...plugins] : [...plugins];

      if (initialSchema) envelopPlugins.unshift(useSchema(initialSchema));

      const getEnveloped = envelop({
        plugins: envelopPlugins,
        extends: envelopExtends,
      });

      const { schema: envelopSchema } = getEnveloped();

      if (enableCodegen) {
        if (outputSchema) {
          import('./outputSchema.js').then(({ writeOutputSchema }) => {
            writeOutputSchema(envelopSchema, config.outputSchema!).catch(onCodegenError);
          });
        }

        import('./codegen.js').then(({ EnvelopCodegen }) => {
          EnvelopCodegen(envelopSchema, config, internalConfig).catch(onCodegenError);
        });
      }

      return adapterFactory(getEnveloped, modulesApplication);
    }
  }

  return {
    registerModule,
    appBuilder,
    gql,
    modules,
  };
}
