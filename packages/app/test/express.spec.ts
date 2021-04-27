import { gql } from 'graphql-modules';

import { HelloDocument } from './generated/express.generated';
import { startExpressServer } from './utils';

test('works', async () => {
  const fetch = await startExpressServer({
    options: {},
    buildOptions: {
      prepare({ registerModule }) {
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
      },
    },
  });

  await fetch(HelloDocument).then(v =>
    expect(v).toMatchInlineSnapshot(`
      Object {
        "data": Object {
          "hello": "hello",
        },
      }
    `)
  );
});
