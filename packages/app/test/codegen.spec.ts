import { promises, existsSync } from 'fs';
import tmp from 'tmp-promise';
import { resolve } from 'path';
import { EnvelopCodegen, gql, LazyPromise, makeExecutableSchema, writeOutputSchema } from '@envelop/app/extend';

const { writeFile, readFile, unlink } = promises;

const TearDownPromises: Promise<void>[] = [];

afterAll(async () => {
  await Promise.all(TearDownPromises);
});

describe('codegen with operations', () => {
  test('gql and ts files', async () => {
    const [tmpGqlFile, tmpTsFile, tmpGeneratedFile] = await Promise.all([
      tmp.file({
        postfix: '.gql',
      }),
      tmp.file({
        postfix: '.ts',
      }),
      tmp.file({
        postfix: '.generated.ts',
      }),
    ]);

    TearDownPromises.push(
      LazyPromise(async () => {
        await Promise.all([tmpGqlFile.cleanup(), tmpTsFile.cleanup(), tmpGeneratedFile.cleanup()]);
      })
    );

    await Promise.all([
      writeFile(
        tmpGqlFile.path,
        `
        query hello {
            hello
        }
        `
      ),
      writeFile(
        tmpTsFile.path,
        `
        const byeQuery = gql\`
            query bye {
                bye
            }
        \`;
        `
      ),
    ]);

    const schema = makeExecutableSchema({
      typeDefs: gql`
        type Query {
          hello: String!
          bye: String!
        }
      `,
    });

    await EnvelopCodegen(
      schema,
      {
        codegen: {
          documents: [tmpGqlFile.path, tmpTsFile.path],
          targetPath: tmpGeneratedFile.path,
          transformGenerated(code) {
            return code.replace(/'.+\/http'/g, "'@envelop/app/http'");
          },
        },
      },
      {
        moduleName: 'http',
      }
    );

    const generatedFile = await readFile(tmpGeneratedFile.path, {
      encoding: 'utf8',
    });

    expect(generatedFile).toContain('export const HelloDocument: DocumentNode<HelloQuery, HelloQueryVariables>');

    expect(generatedFile).toContain('export const ByeDocument: DocumentNode<ByeQuery, ByeQueryVariables>');
  });
});

describe('outputSchema', () => {
  test('wrong extension', async () => {
    const tmpWrongFile = await tmp.file({
      postfix: '.ts',
    });

    TearDownPromises.push(
      LazyPromise(async () => {
        await tmpWrongFile.cleanup();
      })
    );

    const schema = makeExecutableSchema({
      typeDefs: gql`
        type Query {
          hello: String!
        }
      `,
    });
    await expect(
      writeOutputSchema(schema, tmpWrongFile.path).catch(err => {
        throw Error(err.message.replace(tmpWrongFile.path, '###'));
      })
    ).rejects.toMatchInlineSnapshot(
      `[Error: You have to specify a extension between '.gql', '.graphql' and '.json' for the outputSchema, received: "###"]`
    );
  });
  test('default path', async () => {
    const defaultPath = resolve('./schema.gql');

    TearDownPromises.push(
      LazyPromise(async () => {
        if (existsSync(defaultPath)) {
          await unlink(defaultPath);
        }
      })
    );

    const schema = makeExecutableSchema({
      typeDefs: gql`
        type Query {
          hello: String!
        }
      `,
    });

    await writeOutputSchema(schema, true);

    expect(
      await readFile(defaultPath, {
        encoding: 'utf-8',
      })
    ).toMatchInlineSnapshot(`
      "schema {
        query: Query
      }

      type Query {
        hello: String!
      }
      "
    `);
  });
});
