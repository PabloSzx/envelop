import { GraphQLSchema, parse } from 'graphql';
import { resolve } from 'path';

import { codegen } from '@graphql-codegen/core';
import * as typescriptPlugin from '@graphql-codegen/typescript';
import * as typescriptOperationsPlugin from '@graphql-codegen/typescript-operations';
import * as typescriptResolversPlugin from '@graphql-codegen/typescript-resolvers';
import { printSchemaWithDirectives } from '@graphql-tools/utils';

import { formatPrettier } from './prettier.js';
import { writeFileIfChanged } from './write.js';

import type { TypeScriptPluginConfig } from '@graphql-codegen/typescript';
import type { TypeScriptResolversPluginConfig } from '@graphql-codegen/typescript-resolvers/config';

import type { BaseEnvelopAppOptions, InternalEnvelopConfig } from '.';

export interface CodegenConfig extends TypeScriptPluginConfig, TypeScriptResolversPluginConfig {
  /**
   * @description
   * Will use import type {} rather than import {} when importing only types.
   *
   * This gives compatibility with TypeScript's "importsNotUsedAsValues": "error" option
   *
   * @default true
   */
  useTypeImports?: boolean;

  /**
   * Enable deep partial type resolvers
   *
   * @default false
   */
  deepPartialResolvers?: boolean;

  /**
   * Generated target path
   *
   * @default "./src/envelop.generated.ts"
   */
  targetPath?: string;

  /**
   * Add arbitrary code at the beggining of the generated code
   */
  preImportCode?: string;

  /**
   * Handle Code Generation errors
   * @default console.error
   */
  onError?: (err: unknown) => void;
}

export async function EnvelopCodegen(
  executableSchema: GraphQLSchema,
  options: BaseEnvelopAppOptions,
  internalConfig: InternalEnvelopConfig
): Promise<void> {
  const schema = parse(printSchemaWithDirectives(executableSchema));

  const { codegen: { targetPath, deepPartialResolvers, preImportCode = '', scalars, onError, ...codegenOptions } = {} } = options;

  const config: TypeScriptPluginConfig & TypeScriptResolversPluginConfig = {
    useTypeImports: true,
    defaultMapper: deepPartialResolvers ? 'import("@envelop/app").DeepPartial<{T}>' : undefined,
    // TODO: Add default recommended types
    scalars,
    ...codegenOptions,
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
    ${preImportCode}
    ${codegenCode}

    declare module "@envelop/app" {
        interface EnvelopResolvers extends Resolvers<import("@envelop/app").${internalConfig.contextTypeName}> { }
    }
  `,
    'typescript'
  );

  await writeFileIfChanged(resolve(targetPath ?? './src/envelop.generated.ts'), code).catch(onError);
}
