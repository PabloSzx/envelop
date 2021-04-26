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

import type { FastifyEnvelopAppOptions } from './index';
import type { InternalEnvelopConfig } from './common';

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
}

export async function EnvelopCodegen(
  executableSchema: GraphQLSchema,
  options: FastifyEnvelopAppOptions,
  internalConfig: InternalEnvelopConfig
) {
  const schema = parse(printSchemaWithDirectives(executableSchema));

  const { codegen: { targetPath, deepPartialResolvers, ...codegenOptions } = {} } = options;

  const config: CodegenConfig = {
    useTypeImports: true,
    defaultMapper: deepPartialResolvers ? 'import("@envelop/app").DeepPartial<{T}>' : undefined,
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
    ${codegenCode}

    declare module "@envelop/app" {
        interface EnvelopResolvers extends Resolvers<import("@envelop/app").${internalConfig.contextTypeName}> { }
    }
  `,
    'typescript'
  );

  await writeFileIfChanged(resolve(targetPath ?? './src/envelop.generated.ts'), code);
}
