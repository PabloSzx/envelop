export type PlainObject = Record<string | number | symbol, unknown>;

export const isObject = (v: unknown): v is object => v != null && typeof v === 'object';

export const isPlainObject = (v: unknown): v is PlainObject => isObject(v) && !Array.isArray(v);

export function stripUndefineds<T extends object>(obj: Partial<T> = {}): Partial<T> {
  for (const key in obj) {
    obj[key] === undefined && delete obj[key];
  }

  return obj;
}
