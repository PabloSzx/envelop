import type { Envelop } from '@envelop/types';
import type { InternalCodegenConfig } from './app';
import type { CodegenConfig } from './codegen/typescript.js';

export interface WithCodegen {
  /**
   * Enable code generation, by default is enabled if `NODE_ENV` is not `production` nor `test`
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
}

export function handleCodegen(getEnveloped: Envelop<unknown>, config: WithCodegen, internalConfig: InternalCodegenConfig): void {
  const { schema } = getEnveloped();
  const {
    codegen: {
      // eslint-disable-next-line no-console
      onError = console.error,
      onFinish,
    } = {},
    outputSchema,
    enableCodegen,
  } = config;

  if (!enableCodegen) return onFinish?.();

  Promise.all([
    outputSchema
      ? import('./codegen/outputSchema.js').then(({ writeOutputSchema }) => {
          return writeOutputSchema(schema, outputSchema).catch(onError);
        })
      : null,

    import('./codegen/typescript.js').then(({ EnvelopTypeScriptCodegen }) => {
      return EnvelopTypeScriptCodegen(schema, config, internalConfig).catch(onError);
    }),
  ]).then(onFinish, onError);
}