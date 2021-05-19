import { promises } from 'fs';
import tmp from 'tmp-promise';

import { EnvelopCodegen, gql, LazyPromise, makeExecutableSchema } from '@envelop/app/extend';

const { writeFile, readFile } = promises;

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
        const helloQuery = gql\`
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

    expect(
      await readFile(tmpGeneratedFile.path, {
        encoding: 'utf8',
      })
    ).toMatchInlineSnapshot(`
      "import type { GraphQLResolveInfo } from 'graphql';
      import type { EnvelopContext } from '@envelop/app/http';
      import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
      export type Maybe<T> = T | null;
      export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
      export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
      export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
      /** All built-in and custom scalars, mapped to their actual values */
      export type Scalars = {
        ID: string;
        String: string;
        Boolean: boolean;
        Int: number;
        Float: number;
      };

      export type Query = {
        __typename?: 'Query';
        hello: Scalars['String'];
        bye: Scalars['String'];
      };

      export type ResolverTypeWrapper<T> = Promise<T> | T;

      export type LegacyStitchingResolver<TResult, TParent, TContext, TArgs> = {
        fragment: string;
        resolve: ResolverFn<TResult, TParent, TContext, TArgs>;
      };

      export type NewStitchingResolver<TResult, TParent, TContext, TArgs> = {
        selectionSet: string;
        resolve: ResolverFn<TResult, TParent, TContext, TArgs>;
      };
      export type StitchingResolver<TResult, TParent, TContext, TArgs> =
        | LegacyStitchingResolver<TResult, TParent, TContext, TArgs>
        | NewStitchingResolver<TResult, TParent, TContext, TArgs>;
      export type Resolver<TResult, TParent = {}, TContext = {}, TArgs = {}> =
        | ResolverFn<TResult, TParent, TContext, TArgs>
        | StitchingResolver<TResult, TParent, TContext, TArgs>;

      export type ResolverFn<TResult, TParent, TContext, TArgs> = (
        parent: TParent,
        args: TArgs,
        context: TContext,
        info: GraphQLResolveInfo
      ) => Promise<TResult> | TResult;

      export type SubscriptionSubscribeFn<TResult, TParent, TContext, TArgs> = (
        parent: TParent,
        args: TArgs,
        context: TContext,
        info: GraphQLResolveInfo
      ) => AsyncIterator<TResult> | Promise<AsyncIterator<TResult>>;

      export type SubscriptionResolveFn<TResult, TParent, TContext, TArgs> = (
        parent: TParent,
        args: TArgs,
        context: TContext,
        info: GraphQLResolveInfo
      ) => TResult | Promise<TResult>;

      export interface SubscriptionSubscriberObject<TResult, TKey extends string, TParent, TContext, TArgs> {
        subscribe: SubscriptionSubscribeFn<{ [key in TKey]: TResult }, TParent, TContext, TArgs>;
        resolve?: SubscriptionResolveFn<TResult, { [key in TKey]: TResult }, TContext, TArgs>;
      }

      export interface SubscriptionResolverObject<TResult, TParent, TContext, TArgs> {
        subscribe: SubscriptionSubscribeFn<any, TParent, TContext, TArgs>;
        resolve: SubscriptionResolveFn<TResult, any, TContext, TArgs>;
      }

      export type SubscriptionObject<TResult, TKey extends string, TParent, TContext, TArgs> =
        | SubscriptionSubscriberObject<TResult, TKey, TParent, TContext, TArgs>
        | SubscriptionResolverObject<TResult, TParent, TContext, TArgs>;

      export type SubscriptionResolver<TResult, TKey extends string, TParent = {}, TContext = {}, TArgs = {}> =
        | ((...args: any[]) => SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>)
        | SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>;

      export type TypeResolveFn<TTypes, TParent = {}, TContext = {}> = (
        parent: TParent,
        context: TContext,
        info: GraphQLResolveInfo
      ) => Maybe<TTypes> | Promise<Maybe<TTypes>>;

      export type IsTypeOfResolverFn<T = {}, TContext = {}> = (
        obj: T,
        context: TContext,
        info: GraphQLResolveInfo
      ) => boolean | Promise<boolean>;

      export type NextResolverFn<T> = () => Promise<T>;

      export type DirectiveResolverFn<TResult = {}, TParent = {}, TContext = {}, TArgs = {}> = (
        next: NextResolverFn<TResult>,
        parent: TParent,
        args: TArgs,
        context: TContext,
        info: GraphQLResolveInfo
      ) => TResult | Promise<TResult>;

      /** Mapping between all available schema types and the resolvers types */
      export type ResolversTypes = {
        Query: ResolverTypeWrapper<{}>;
        String: ResolverTypeWrapper<Scalars['String']>;
        Boolean: ResolverTypeWrapper<Scalars['Boolean']>;
        Int: ResolverTypeWrapper<Scalars['Int']>;
      };

      /** Mapping between all available schema types and the resolvers parents */
      export type ResolversParentTypes = {
        Query: {};
        String: Scalars['String'];
        Boolean: Scalars['Boolean'];
        Int: Scalars['Int'];
      };

      export type QueryResolvers<
        ContextType = EnvelopContext,
        ParentType extends ResolversParentTypes['Query'] = ResolversParentTypes['Query']
      > = {
        hello?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
        bye?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
      };

      export type Resolvers<ContextType = EnvelopContext> = {
        Query?: QueryResolvers<ContextType>;
      };

      /**
       * @deprecated
       * Use \\"Resolvers\\" root object instead. If you wish to get \\"IResolvers\\", add \\"typesPrefix: I\\" to your config.
       */
      export type IResolvers<ContextType = EnvelopContext> = Resolvers<ContextType>;

      export type HelloQueryVariables = Exact<{ [key: string]: never }>;

      export type HelloQuery = { __typename?: 'Query' } & Pick<Query, 'hello'>;

      export type ByeQueryVariables = Exact<{ [key: string]: never }>;

      export type ByeQuery = { __typename?: 'Query' } & Pick<Query, 'bye'>;

      export const HelloDocument: DocumentNode<HelloQuery, HelloQueryVariables> = {
        kind: 'Document',
        definitions: [
          {
            kind: 'OperationDefinition',
            operation: 'query',
            name: { kind: 'Name', value: 'hello' },
            selectionSet: { kind: 'SelectionSet', selections: [{ kind: 'Field', name: { kind: 'Name', value: 'hello' } }] },
          },
        ],
      };
      export const ByeDocument: DocumentNode<ByeQuery, ByeQueryVariables> = {
        kind: 'Document',
        definitions: [
          {
            kind: 'OperationDefinition',
            operation: 'query',
            name: { kind: 'Name', value: 'bye' },
            selectionSet: { kind: 'SelectionSet', selections: [{ kind: 'Field', name: { kind: 'Name', value: 'bye' } }] },
          },
        ],
      };

      declare module '@envelop/app/http' {
        interface EnvelopResolvers extends Resolvers<import('@envelop/app/http').EnvelopContext> {}
      }
      "
    `);
  });
});
