// Based on `p-lazy`: https://github.com/sindresorhus/p-lazy/blob/main/index.js

class PLazy<ValueType> extends Promise<ValueType> {
  private _executor: any;
  private _promise: any;

  constructor(executor: any) {
    super((resolve: any) => resolve());

    this._executor = executor;
  }

  then(onFulfilled: any, onRejected: any) {
    this._promise = this._promise || new Promise(this._executor);
    return this._promise.then(onFulfilled, onRejected);
  }

  catch(onRejected: any) {
    this._promise = this._promise || new Promise(this._executor);
    return this._promise.catch(onRejected);
  }
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
