const { CreateApp }: typeof import('../../../../src/nextjs') = require('../../../../dist/cjs/nextjs');

// Blocked by this issue https://github.com/vercel/next.js/issues/9358
// import { CreateApp } from '../../../../src/nextjs';

function buildContext(_args: import('../../../../src/nextjs').BuildContextArgs) {
  return {
    foo: 'bar',
  };
}

export const { buildApp, registerModule, gql } = CreateApp({
  buildContext,
  enableCodegen: false,
});
