import type { ParserCacheOptions } from '@envelop/parser-cache';
import type { ValidationCacheOptions } from '@envelop/validation-cache';
import type { Plugin } from '@envelop/core';

export type CacheOptions =
  | boolean
  | {
      /**
       * Enable/Disable or customize cache options
       * @default true
       */
      parse?: boolean | ParserCacheOptions;
      /**
       * Enable/Disable or customize cache options
       * @default true
       */
      validation?: boolean | ValidationCacheOptions;
    };

export function CachePlugins(options: CacheOptions, plugins: Plugin[]): void | Promise<unknown> {
  if (!options) return;

  const isParserEnabled = options === true || !!options.parse;
  const isValidationEnabled = options === true || !!options.validation;

  const parserOptions = options === true ? {} : typeof options.parse === 'object' ? options.parse : {};

  const validationOptions = options === true ? {} : typeof options.validation === 'object' ? options.validation : {};

  return Promise.all([
    isParserEnabled
      ? import('@envelop/parser-cache').then(({ useParserCache }) => {
          plugins.push(useParserCache(parserOptions));
        })
      : null,
    isValidationEnabled
      ? import('@envelop/validation-cache').then(({ useValidationCache }) => {
          plugins.push(useValidationCache(validationOptions));
        })
      : null,
  ]);
}
