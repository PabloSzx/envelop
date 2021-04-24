import type { Envelop } from '@envelop/types';
import type { BaseEnvelopAppOptions, InternalEnvelopConfig } from '../app.js';

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
    } = {},
    outputSchema,
  } = config;

  Promise.all([
    outputSchema
      ? import('./outputSchema.js').then(({ writeOutputSchema }) => {
          writeOutputSchema(schema, outputSchema).catch(onCodegenError);
        })
      : null,

    import('./typescript.js').then(({ EnvelopCodegen }) => {
      EnvelopCodegen(schema, config, internalConfig).catch(onCodegenError);
    }),
  ]).catch(onCodegenError);
}
