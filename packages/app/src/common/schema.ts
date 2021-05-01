import { GraphQLSchema, isSchema } from 'graphql';

import { useSchema } from '@envelop/core';
import { mergeSchemasAsync } from '@graphql-tools/merge';
import { makeExecutableSchema } from '@graphql-tools/schema';

import { cleanObject, toPlural } from './utils/object.js';
import { LazyPromise } from './utils/promise.js';

import type { Plugin } from '@envelop/types';
import type { Application, Module } from 'graphql-modules';
import type { FilteredMergeSchemasConfig, SchemaDefinition } from './app';
import type { ScalarsModule } from './scalars';

export interface SchemaBuilderFactoryOptions {
  scalarsModule?: ScalarsModule | null;
  mergeSchemasConfig?: FilteredMergeSchemasConfig;
}

export interface PrepareSchemaOptions {
  schema: SchemaDefinition<never> | SchemaDefinition<never>[];
  appPlugins: Plugin[];
  appModules: Module[];
  modulesApplication?: Application;
}

export function SchemaBuilderFactory({
  scalarsModule,
  mergeSchemasConfig,
}: SchemaBuilderFactoryOptions): (options: PrepareSchemaOptions) => Promise<void> {
  return async function PrepareSchema({ schema, appModules, modulesApplication, appPlugins }: PrepareSchemaOptions) {
    const scalarsModuleSchema =
      scalarsModule &&
      LazyPromise(() => {
        return makeExecutableSchema({
          typeDefs: scalarsModule.typeDefs,
          resolvers: scalarsModule.resolvers,
        });
      });

    const schemas = await Promise.all(
      toPlural(schema).map(async schemaValuePromise => {
        const schemaValue = await schemaValuePromise;
        if (isSchema(schemaValue)) {
          if (!scalarsModuleSchema) return schemaValue;

          return mergeSchemasAsync({
            ...cleanObject(mergeSchemasConfig),
            schemas: [await scalarsModuleSchema, schemaValue],
          });
        }

        return makeExecutableSchema({
          ...schemaValue,
          typeDefs: scalarsModule ? [...toPlural(schemaValue.typeDefs), scalarsModule.typeDefs] : schemaValue.typeDefs,
          resolvers: scalarsModule ? [...toPlural(schemaValue.resolvers || []), scalarsModule.resolvers] : schemaValue.resolvers,
        });
      })
    );

    let mergedSchema: GraphQLSchema;

    const modulesSchemaList = appModules.length && modulesApplication ? [modulesApplication.schema] : [];

    if (schemas.length > 1) {
      mergedSchema = await mergeSchemasAsync({
        ...cleanObject(mergeSchemasConfig),
        schemas: [...modulesSchemaList, ...schemas],
      });
    } else if (schemas[0]) {
      mergedSchema = modulesSchemaList[0]
        ? await mergeSchemasAsync({
            ...cleanObject(mergeSchemasConfig),
            schemas: [...modulesSchemaList, schemas[0]],
          })
        : schemas[0];
    } else {
      throw Error('No GraphQL Schema specified!');
    }

    appPlugins.push(useSchema(mergedSchema));
  };
}
