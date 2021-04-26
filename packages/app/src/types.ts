import type { ApplicationConfig, ModuleConfig } from 'graphql-modules';
import type { ExecutionContext } from 'graphql-helix/dist/types';
import type { EnvelopOptions } from '@envelop/core';
import type { resolvers as scalarResolvers } from 'graphql-scalars';

import type { CodegenConfig } from './codegen';

type PossiblePromise<T> = T | Promise<T>;

export type DeepPartial<T> = T extends Function
  ? T
  : T extends Array<infer U>
  ? DeepPartialArray<U>
  : T extends object
  ? DeepPartialObject<T>
  : T | undefined;

interface DeepPartialArray<T> extends Array<PossiblePromise<DeepPartial<PossiblePromise<T>>>> {}
type DeepPartialObject<T> = {
  [P in keyof T]?: PossiblePromise<DeepPartial<PossiblePromise<T[P]>>>;
};

export interface EnvelopResolvers {}

export type EnvelopModuleConfig = Omit<ModuleConfig, 'typeDefs' | 'id' | 'resolvers'> & {
  id?: string;
  resolvers?: EnvelopResolvers;
};

export interface EnvelopContext extends GraphQLModules.ModuleContext, ExecutionContext {}

export interface BaseEnvelopAppOptions extends Partial<EnvelopOptions>, Partial<Omit<ApplicationConfig, 'modules'>> {
  /**
   * Enable code generation, by default it's enabled if `NODE_ENV` is not `production` nor `test`
   *
   * @default process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test"
   */
  enableCodegen?: boolean;
  /**
   * Add custom codegen config
   */
  codegen?: CodegenConfig;
  /**
   * Output schema target path or flag
   *
   * If `true`, defaults to `"./schema.gql"`
   * You can specify a `.gql`, `.graphql` or `.json` extension
   *
   * @default false
   */
  outputSchema?: boolean | string;
  /**
   * Add scalars
   */
  scalars?: '*' | { [k in keyof typeof scalarResolvers]?: boolean };
}
