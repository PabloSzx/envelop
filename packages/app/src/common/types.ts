import type { ModuleConfig } from 'graphql-modules';
import type { ExecutionContext } from 'graphql-helix/dist/types';

type PossiblePromise<T> = T | Promise<T>;

export type DeepPartial<T> = T extends Function
  ? T
  : T extends Array<infer U>
  ? // eslint-disable-next-line no-use-before-define
    DeepPartialArray<U>
  : T extends object
  ? // eslint-disable-next-line no-use-before-define
    DeepPartialObject<T>
  : T | undefined;

interface DeepPartialArray<T> extends Array<PossiblePromise<DeepPartial<PossiblePromise<T>>>> {}
type DeepPartialObject<T> = {
  [P in keyof T]?: PossiblePromise<DeepPartial<PossiblePromise<T[P]>>>;
};

export interface EnvelopContext extends GraphQLModules.ModuleContext, ExecutionContext {}

export interface EnvelopResolvers extends Record<string, any> {}

export type EnvelopModuleConfig = Omit<ModuleConfig, 'typeDefs' | 'id' | 'resolvers'> & {
  id?: string;
  resolvers?: EnvelopResolvers;
  /**
   * Automatically add the create module in the built envelop app
   *
   * @default true
   */
  autoAdd?: boolean;
};

type PromiseType<T> = T extends PromiseLike<infer U> ? U : T;

export type InferFunctionReturn<TFunction extends (...args: any) => any> = PromiseType<ReturnType<TFunction>>;

export type { AltairOptions, GraphiQLOptions, IDEOptions } from './ide/handle';

export type { ScalarsConfig } from './scalars';

export type { CodegenConfig, CodegenDocumentsConfig } from './codegen/typescript';

export type { InferDataLoader } from './dataloader';
