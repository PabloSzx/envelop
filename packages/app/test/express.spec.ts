import { readFile } from 'fs/promises';
import { buildClientSchema, getIntrospectionQuery, IntrospectionQuery, printSchema } from 'graphql';

import { gql } from '@envelop/app/extend';

import { HelloDocument, UsersDocument } from './generated/envelop.generated';
import { commonImplementation, startExpressServer } from './utils';

const serverReady = startExpressServer({
  options: {
    scalars: ['DateTime'],
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

test('altair', async () => {
  const { request } = await serverReady;

  expect(
    (
      await request({
        path: '/altair',
        method: 'GET',
      })
    ).slice(0, 300)
  ).toMatchInlineSnapshot(`"Moved Permanently. Redirecting to /altair/"`);

  expect(
    (
      await request({
        path: '/altair/styles.css',
        method: 'GET',
      })
    ).slice(0, 300)
  ).toMatchInlineSnapshot(
    `"@charset \\"UTF-8\\";[class*=ant-]::-ms-clear,[class*=ant-] input::-ms-clear,[class*=ant-] input::-ms-reveal,[class^=ant-]::-ms-clear,[class^=ant-] input::-ms-clear,[class^=ant-] input::-ms-reveal{display:none}[class*=ant-],[class*=ant-] *,[class*=ant-] :after,[class*=ant-] :before,[class^=ant-],[class^"`
  );
});

test('graphiql', async () => {
  const { request } = await serverReady;

  expect(
    (
      await request({
        path: '/graphiql',
        method: 'GET',
      })
    ).slice(0, 300)
  ).toMatchInlineSnapshot(`
    "
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset=\\"utf-8\\" />
        <title>GraphiQL</title>
        <meta name=\\"robots\\" content=\\"noindex\\" />
        <meta name=\\"referrer\\" content=\\"origin\\" />
        <meta name=\\"viewport\\" content=\\"width=device-width, initial-scale=1\\" />
        <link
          rel=\\"icon\\"
          type=\\"image"
  `);
});

test('resulting schema', async () => {
  const { query } = await serverReady;

  const schema = buildClientSchema((await query<IntrospectionQuery, never>(gql(getIntrospectionQuery()))).data!);
  expect(printSchema(schema)).toMatchInlineSnapshot(`
    "type Query {
      hello: String!
      users: [User!]!
    }

    type User {
      id: Int!
    }

    \\"\\"\\"
    A date-time string at UTC, such as 2007-12-03T10:15:30Z, compliant with the \`date-time\` format outlined in section 5.6 of the RFC 3339 profile of the ISO 8601 standard for representation of dates and times using the Gregorian calendar.
    \\"\\"\\"
    scalar DateTime
    "
  `);
});

test('codegen result', async () => {
  const { tmpPath, codegenPromise } = await serverReady;

  await codegenPromise;

  expect(tmpPath).toBeTruthy();

  expect(
    await readFile(tmpPath!, {
      encoding: 'utf-8',
    })
  ).toMatchInlineSnapshot(`
    "import type { GraphQLResolveInfo, GraphQLScalarType, GraphQLScalarTypeConfig } from 'graphql';
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
      /** A date-time string at UTC, such as 2007-12-03T10:15:30Z, compliant with the \`date-time\` format outlined in section 5.6 of the RFC 3339 profile of the ISO 8601 standard for representation of dates and times using the Gregorian calendar. */
      DateTime: any;
    };

    export type Query = {
      __typename?: 'Query';
      hello: Scalars['String'];
      users: Array<User>;
    };

    export type User = {
      __typename?: 'User';
      id: Scalars['Int'];
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
      User: ResolverTypeWrapper<User>;
      Int: ResolverTypeWrapper<Scalars['Int']>;
      DateTime: ResolverTypeWrapper<Scalars['DateTime']>;
      Boolean: ResolverTypeWrapper<Scalars['Boolean']>;
    };

    /** Mapping between all available schema types and the resolvers parents */
    export type ResolversParentTypes = {
      Query: {};
      String: Scalars['String'];
      User: User;
      Int: Scalars['Int'];
      DateTime: Scalars['DateTime'];
      Boolean: Scalars['Boolean'];
    };

    export type QueryResolvers<
      ContextType = any,
      ParentType extends ResolversParentTypes['Query'] = ResolversParentTypes['Query']
    > = {
      hello?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
      users?: Resolver<Array<ResolversTypes['User']>, ParentType, ContextType>;
    };

    export type UserResolvers<ContextType = any, ParentType extends ResolversParentTypes['User'] = ResolversParentTypes['User']> = {
      id?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
      __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
    };

    export interface DateTimeScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['DateTime'], any> {
      name: 'DateTime';
    }

    export type Resolvers<ContextType = any> = {
      Query?: QueryResolvers<ContextType>;
      User?: UserResolvers<ContextType>;
      DateTime?: GraphQLScalarType;
    };

    /**
     * @deprecated
     * Use \\"Resolvers\\" root object instead. If you wish to get \\"IResolvers\\", add \\"typesPrefix: I\\" to your config.
     */
    export type IResolvers<ContextType = any> = Resolvers<ContextType>;

    declare module '@pablosz/envelop-app/express' {
      interface EnvelopResolvers extends Resolvers<import('@pablosz/envelop-app/express').EnvelopContext> {}
    }
    "
  `);
});

test('outputSchema result', async () => {
  const { tmpSchemaPath, codegenPromise } = await serverReady;

  await codegenPromise;

  expect(tmpSchemaPath).toBeTruthy();

  expect(
    await readFile(tmpSchemaPath!, {
      encoding: 'utf-8',
    })
  ).toMatchInlineSnapshot(`
    "schema {
      query: Query
    }

    type Query {
      hello: String!
      users: [User!]!
    }

    type User {
      id: Int!
    }

    \\"\\"\\"
    A date-time string at UTC, such as 2007-12-03T10:15:30Z, compliant with the \`date-time\` format outlined in section 5.6 of the RFC 3339 profile of the ISO 8601 standard for representation of dates and times using the Gregorian calendar.
    \\"\\"\\"
    scalar DateTime
    "
  `);
});
