import { GraphQLSchema, parse } from 'graphql';
import { resolve } from 'path';

import { codegen } from '@graphql-codegen/core';
import * as typescriptPlugin from '@graphql-codegen/typescript';
import * as typescriptOperationsPlugin from '@graphql-codegen/typescript-operations';
import * as typescriptResolversPlugin from '@graphql-codegen/typescript-resolvers';
import { printSchemaWithDirectives } from '@graphql-tools/utils';

import { cleanObject } from '../utils/object.js';
import { formatPrettier } from './prettier.js';
import { writeFileIfChanged } from './write.js';

import type { CodegenPlugin, Types } from '@graphql-codegen/plugin-helpers';
import type { Source } from '@graphql-tools/utils';
import type { LoadTypedefsOptions, UnnormalizedTypeDefPointer } from '@graphql-tools/load';
import type { TypeScriptPluginConfig } from '@graphql-codegen/typescript';
import type { TypeScriptResolversPluginConfig } from '@graphql-codegen/typescript-resolvers/config';
import type { BaseEnvelopAppOptions, InternalEnvelopConfig } from '../app';

export interface CodegenDocumentsConfig {
  /**
   * @default true
   */
  useTypedDocumentNode?: boolean;

  /**
   * Configuration used while loading the documents
   */
  loadDocuments?: Partial<LoadTypedefsOptions>;
}

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

  /**
   * GraphQL Codegen plugin context
   */
  pluginContext?: Record<string, any>;

  /**
   * Extra plugins map
   */
  extraPluginsMap?: Record<string, CodegenPlugin<any>>;

  /**
   * Extra plugins config
   */
  extraPluginsConfig?: Types.ConfiguredPlugin[];

  /**
   * Asynchronously loads executable documents (i.e. operations and fragments) from
   * the provided pointers. The pointers may be individual files or a glob pattern.
   * The files themselves may be `.graphql` files or `.js` and `.ts` (in which
   * case they will be parsed using graphql-tag-pluck).
   */
  documents?: UnnormalizedTypeDefPointer | UnnormalizedTypeDefPointer[];

  /**
   * Documents config
   */
  documentsConfig?: CodegenDocumentsConfig;

  /**
   * Skip documents validation
   */
  skipDocumentsValidation?: boolean;
}

export async function EnvelopCodegen(
  executableSchema: GraphQLSchema,
  options: BaseEnvelopAppOptions<never>,
  internalConfig: InternalEnvelopConfig
): Promise<void> {
  const moduleName = `@envelop/app/${internalConfig.moduleName}`;
  const schema = parse(printSchemaWithDirectives(executableSchema));

  const {
    codegen: {
      targetPath,
      deepPartialResolvers,
      preImportCode = '',
      scalars,
      onError,
      pluginContext,
      skipDocumentsValidation,
      documents: documentsArg,
      documentsConfig = {},
      extraPluginsMap,
      extraPluginsConfig,
      ...codegenOptions
    } = {},
  } = options;

  const { useTypedDocumentNode = true, loadDocuments: loadDocumentsConfig } = documentsConfig;

  const config: TypeScriptPluginConfig & TypeScriptResolversPluginConfig = {
    useTypeImports: true,
    defaultMapper: deepPartialResolvers ? `import("${moduleName}").DeepPartial<{T}>` : undefined,
    // TODO: Add default recommended types
    scalars,
    ...codegenOptions,
  };

  const pluginMap: Record<string, CodegenPlugin<any>> = {
    typescript: typescriptPlugin,
    typescriptResolvers: typescriptResolversPlugin,
    typescriptOperations: typescriptOperationsPlugin,
    ...cleanObject(extraPluginsMap),
  };

  const documents: Source[] = [];

  if (documentsArg) {
    const [{ loadDocuments }, { GraphQLFileLoader }, typedDocumentNode, { CodeFileLoader }] = await Promise.all([
      import('@graphql-tools/load'),
      import('@graphql-tools/graphql-file-loader'),
      useTypedDocumentNode ? import('@graphql-codegen/typed-document-node') : null,
      import('@graphql-tools/code-file-loader'),
    ]);

    const loadedDocuments = await loadDocuments(documentsArg, {
      loaders: [new GraphQLFileLoader(), new CodeFileLoader()],
      ...cleanObject(loadDocumentsConfig),
    });

    documents.push(...loadedDocuments);

    if (typedDocumentNode) pluginMap.typedDocumentNode = typedDocumentNode;
  }

  const codegenCode = await codegen({
    schema,
    documents,
    config,
    filename: 'envelop.generated.ts',
    pluginMap,
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
      ...(useTypedDocumentNode && documentsArg
        ? [
            {
              typedDocumentNode: {},
            },
          ]
        : []),
      ...(extraPluginsConfig || []),
    ],
    pluginContext,
    skipDocumentsValidation,
  });

  const code = await formatPrettier(
    `
    ${preImportCode}
    ${codegenCode}

    declare module "${moduleName}" {
        interface EnvelopResolvers extends Resolvers<import("${moduleName}").EnvelopContext> { }
    }
  `,
    'typescript'
  );

  await writeFileIfChanged(resolve(targetPath ?? './src/envelop.generated.ts'), code).catch(onError);
}
