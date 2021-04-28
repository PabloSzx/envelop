import { gql } from 'graphql-modules';

import { HelloDocument } from './generated/envelop.generated';
import { startHTTPServer } from './utils';

const queryPromise = startHTTPServer({
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
                return 'Hello World!';
              },
            },
          },
        }
      );
    },
  },
});

test('works', async () => {
  const query = await queryPromise;

  await query(HelloDocument).then(v => {
    expect(v).toMatchInlineSnapshot(`
      Object {
        "data": Object {
          "hello": "Hello World!",
        },
      }
    `);
  });
});
