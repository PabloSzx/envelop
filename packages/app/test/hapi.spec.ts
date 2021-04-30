import { promises } from 'fs';

import { HelloDocument, UsersDocument } from './generated/envelop.generated';
import { commonImplementation, startHapiServer } from './utils';

const serverReady = startHapiServer({
  options: {
    scalars: '*',
    enableCodegen: true,
  },
  buildOptions: {
    prepare(tools) {
      commonImplementation(tools);
    },
  },
});

test('works', async () => {
  const { query } = await serverReady;

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

test('dataloaders', async () => {
  const { query } = await serverReady;

  await query(UsersDocument).then(v => {
    expect(v).toMatchInlineSnapshot(`
      Object {
        "data": Object {
          "users": Array [
            Object {
              "id": 0,
            },
            Object {
              "id": 100,
            },
            Object {
              "id": 200,
            },
            Object {
              "id": 300,
            },
            Object {
              "id": 400,
            },
            Object {
              "id": 500,
            },
            Object {
              "id": 600,
            },
            Object {
              "id": 700,
            },
            Object {
              "id": 800,
            },
            Object {
              "id": 900,
            },
          ],
        },
      }
    `);
  });
});

test('outputSchema result', async () => {
  const { tmpSchemaPath } = await serverReady;

  console.log(8080, tmpSchemaPath);

  expect(
    await promises.readFile(tmpSchemaPath, {
      encoding: 'utf-8',
    })
  ).toMatchInlineSnapshot(`""`);
});
