import { GraphQLSchema, parse } from 'graphql';
import { resolve } from 'path';

import { codegen } from '@graphql-codegen/core';
import * as typescriptPlugin from '@graphql-codegen/typescript';
import * as typescriptOperationsPlugin from '@graphql-codegen/typescript-operations';
import * as typescriptResolversPlugin from '@graphql-codegen/typescript-resolvers';
import { printSchemaWithDirectives } from '@graphql-tools/utils';

import { formatPrettier } from './prettier';
import { writeFileIfChanged } from './write';

import type { TypeScriptPluginConfig } from '@graphql-codegen/typescript';
import type { TypeScriptResolversPluginConfig } from '@graphql-codegen/typescript-resolvers/config';

import type { EnvelopAppOptions } from './index';

export type CodegenPluginsConfig = TypeScriptPluginConfig & TypeScriptResolversPluginConfig;

export async function EnvelopCodegen(executableSchema: GraphQLSchema, options: EnvelopAppOptions) {
  const schema = parse(printSchemaWithDirectives(executableSchema));

  const config: CodegenPluginsConfig = {
    useTypeImports: true,
    defaultMapper: options.deepPartialResolvers ? 'import("@envelop/app").DeepPartial<{T}>' : undefined,
    ...options.codegenConfig,
  };

  const codegenCode = await codegen({
    schema,
    documents: [],
    config,
    filename: 'envelop.generated.ts',
    pluginMap: {
      typescript: typescriptPlugin,
      typescriptResolvers: typescriptResolversPlugin,
      typescriptOperations: typescriptOperationsPlugin,
    },
    plugins: [
      {
        typescript: {},
      },
      {
        typescriptResolvers: {},
      },
      {
        typescriptOperations: {},
      },
    ],
  });

  const code = await formatPrettier(
    `
    ${codegenCode}

    declare module "@envelop/app" {
        interface EnvelopResolvers extends Resolvers<{}> { }
    }
  `,
    'typescript'
  );

  await writeFileIfChanged(resolve(options.targetPath ?? './src/envelop.generated.ts'), code);
}
