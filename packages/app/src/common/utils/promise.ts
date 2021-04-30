// Based on `p-lazy`: https://github.com/sindresorhus/p-lazy/blob/main/index.js

export class PLazy<ValueType> extends Promise<ValueType> {
  private _executor;
  private _promise?: Promise<ValueType>;

  constructor(executor: (resolve: (value: ValueType) => void, reject: (err: unknown) => void) => void) {
    super((resolve: (v?: any) => void) => resolve());

    this._executor = executor;
  }

  then: Promise<ValueType>['then'] = (onFulfilled, onRejected) => {
    this._promise = this._promise || new Promise(this._executor);
    return this._promise.then(onFulfilled, onRejected);
  };

  catch: Promise<ValueType>['catch'] = onRejected => {
    this._promise = this._promise || new Promise(this._executor);
    return this._promise.catch(onRejected);
  };

  finally: Promise<ValueType>['finally'] = onFinally => {
    this._promise = this._promise || new Promise(this._executor);
    return this._promise.finally(onFinally);
  };
}

export function LazyPromise<Value>(fn: () => Value | Promise<Value>): Promise<Value> {
  return new PLazy((resolve: (value: Value) => void, reject: (err: unknown) => void) => {
    try {
      Promise.resolve(fn()).then(resolve, err => {
        if (err instanceof Error) Error.captureStackTrace(err, LazyPromise);

        reject(err);
      });
    } catch (err) {
      if (err instanceof Error) Error.captureStackTrace(err, LazyPromise);

      reject(err);
    }
  });
}

export interface DeferredPromise<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export function createDeferredPromise<T = void>(): DeferredPromise<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolveFn, rejectFn) => {
    resolve = resolveFn;
    reject = rejectFn;
  });

  return {
    promise,
    resolve,
    reject,
  };
}
