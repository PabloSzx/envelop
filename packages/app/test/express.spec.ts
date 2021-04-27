import { gql } from 'graphql-modules';

import { HelloDocument } from './generated/envelop.generated';
import { startExpressServer } from './utils';

const queryPromise = startExpressServer({
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

test('works', async () => {
  const query = await queryPromise;

  await query(HelloDocument).then(v =>
    expect(v).toMatchInlineSnapshot(`
      Object {
        "data": Object {
          "hello": "hello",
        },
      }
    `)
  );
});
