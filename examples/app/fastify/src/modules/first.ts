import { registerModule, gql } from '../app';

registerModule(
  gql`
    type Query {
      hello: String!
    }
  `,
  {
    resolvers: {
      Query: {
        hello(_root, _args, _ctx) {
          return 'hello';
        },
      },
    },
  }
);
