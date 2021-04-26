import { executeSync, getIntrospectionQuery, GraphQLSchema, parse } from 'graphql';
import { resolve } from 'path';

import { printSchemaWithDirectives } from '@graphql-tools/utils';

import { formatPrettier } from './prettier';
import { writeFileIfChanged } from './write';

export async function writeOutputSchema(schema: GraphQLSchema, config: string | boolean) {
  if (!config) return;

  let targetPath: string;
  if (typeof config === 'boolean') {
    targetPath = resolve('./schema.gql');
  } else {
    if (!config.endsWith('.gql') || config.endsWith('.graphql') || config.endsWith('.json')) {
      console.error(`You have to specify a extension between '.gql', '.graphql' and '.json', received: "${config}"`);
      return;
    }

    targetPath = resolve(config);
  }

  let schemaString: string;

  if (targetPath.endsWith('.json')) {
    const result = executeSync({
      schema,
      document: parse(getIntrospectionQuery()),
    });
    schemaString = await formatPrettier(JSON.stringify(result.data, null, 2), 'json-stringify');
  } else {
    schemaString = await formatPrettier(printSchemaWithDirectives(schema), 'graphql');
  }
  await writeFileIfChanged(targetPath, schemaString);
}
