import { CreateEnvelopApp } from '@envelop/app';

export const { registerModule, buildApp, gql } = CreateEnvelopApp({
  codegen: {
    federation: true,
    deepPartialResolvers: true,
    targetPath: './src/envelop.generated.ts',
  },
  outputSchema: './schema.gql',
  scalars: {
    DateTime: true,
  },
});
