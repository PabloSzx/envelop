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
