import type { Envelop } from '@envelop/core';
import type { BaseEnvelopAppOptions, InternalEnvelopConfig } from '../app';

export function handleCodegen(
  getEnveloped: Envelop<unknown>,
  config: BaseEnvelopAppOptions<never>,
  internalConfig: InternalEnvelopConfig
): void {
  const { schema } = getEnveloped();
  const {
    codegen: {
      // eslint-disable-next-line no-console
      onError: onCodegenError = console.error,
      onFinish,
    } = {},
    outputSchema,
  } = config;

  Promise.all([
    outputSchema
      ? import('./outputSchema.js').then(({ writeOutputSchema }) => {
          return writeOutputSchema(schema, outputSchema).catch(onCodegenError);
        })
      : null,

    import('./typescript.js').then(({ EnvelopCodegen }) => {
      return EnvelopCodegen(schema, config, internalConfig).catch(onCodegenError);
    }),
  ]).then(onFinish, onCodegenError);
}
