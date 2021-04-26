import { GraphiQLHandler } from '@pablosz/envelop-app/nextjs';

export default GraphiQLHandler({
  subscriptionsEndpoint: 'http://localhost:3000/api/graphql',
});
