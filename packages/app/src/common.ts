import { Application, createApplication, createModule, gql, Module, TypeDefs } from 'graphql-modules';
import { resolvers as scalarResolvers, typeDefs as scalarTypeDefs } from 'graphql-scalars';

import { Envelop, envelop } from '@envelop/core';
import { useGraphQLModules } from '@envelop/graphql-modules';

import { BaseEnvelopAppOptions, EnvelopModuleConfig } from './types';

export type AdapterFactory<T> = (envelop: Envelop<unknown>, modulesApplication: Application) => T;

export interface InternalEnvelopConfig {
  contextTypeName: string;
}

export function CreateEnvelopAppFactory(config: BaseEnvelopAppOptions, internalConfig: InternalEnvelopConfig) {
  const modules: Module[] = [];
  let acumId = 0;

  const { scalars } = config;

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
              const resolver =
                //@ts-expect-error
                scalarResolvers[scalarName];

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
        initialSchema,
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

      const getEnveloped = envelop({
        plugins: modules.length ? [useGraphQLModules(modulesApplication), ...plugins] : plugins,
        initialSchema,
        extends: envelopExtends,
      });

      const { schema } = getEnveloped();

      if (enableCodegen) {
        if (outputSchema) {
          import('./outputSchema').then(({ writeOutputSchema }) => {
            writeOutputSchema(schema, config.outputSchema!).catch(console.error);
          });
        }

        import('./codegen')
          .then(({ EnvelopCodegen }) => {
            EnvelopCodegen(schema, config, internalConfig).catch(console.error);
          })
          .catch(console.error);
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
