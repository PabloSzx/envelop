import { CreateApp, BuildContextArgs, InferFunctionReturn } from '@envelop/app/express';

function buildContext({ request }: BuildContextArgs) {
  return {
    request,
    foo: 'bar',
  };
}

declare module '@envelop/app/express' {
  interface EnvelopContext extends InferFunctionReturn<typeof buildContext> {}
}

export const { registerModule, buildApp, gql } = CreateApp({
  codegen: {
    federation: true,
    deepPartialResolvers: true,
    targetPath: './src/envelop.generated.ts',
    preImportCode: `
    /* eslint-disable no-use-before-define */
    `,
    scalars: {
      DateTime: 'string',
    },
  },
  outputSchema: './schema.gql',
  scalars: {
    DateTime: true,
  },
  buildContext,
  websocketSubscriptions: 'all',
  ide: {
    altair: true,
    graphiql: true,
  },
});
