import { renderGraphiQL } from 'graphql-helix';

import { stripUndefineds } from './utils/object.js';

import type { RenderOptions } from 'altair-static';
import type { RenderGraphiQLOptions } from 'graphql-helix/dist/types';

export interface GraphiQLOptions extends RenderGraphiQLOptions {
  /**
   * @default "/graphiql"
   */
  path?: string;
}

export interface AltairOptions extends RenderOptions {
  /**
   * @default "/altair"
   */
  path?: string;
}

export type IDEOptions<
  TAltairOptions extends AltairOptions = AltairOptions,
  TGraphiQLOptions extends GraphiQLOptions = GraphiQLOptions
> =
  | boolean
  | {
      altair?: boolean | TAltairOptions;
      graphiql?: boolean | TGraphiQLOptions;
    };

export interface InternalIDEOptions<AltairOptions extends RenderOptions = RenderOptions> {
  handleAltair: (options: AltairOptions & { path: string }) => Promise<void> | void;
  handleGraphiQL: (graphiqlHTML: GraphiQLOptions & { html: string; path: string }) => void | Promise<void>;
}

export interface IDEConfig {
  altairOptions: AltairOptions & { path: string };
  graphiQLOptions: GraphiQLOptions & { path: string };
  isAltairEnabled: boolean;
  isGraphiQLEnabled: boolean;
}

export type NamesIDEs = 'altair' | 'graphiql';

export function parseIDEConfig(userOptions: IDEOptions, defaultEnabled: NamesIDEs = 'altair'): IDEConfig {
  const options =
    typeof userOptions === 'boolean'
      ? { altair: defaultEnabled === 'altair', graphiql: defaultEnabled === 'graphiql' }
      : userOptions;

  const altairOptions = {
    path: '/altair',
    ...(typeof options.altair === 'boolean' ? {} : stripUndefineds(options.altair) || {}),
  };
  const graphiQLOptions = {
    path: '/graphiql',
    ...(typeof options.graphiql === 'boolean' ? {} : stripUndefineds(options.graphiql) || {}),
  };

  const isAltairEnabled = !!options.altair;

  const isGraphiQLEnabled = !!options.graphiql;

  return {
    altairOptions,
    graphiQLOptions,
    isAltairEnabled,
    isGraphiQLEnabled,
  };
}

export async function handleIDE(
  userOptions: IDEOptions = true,
  internal: InternalIDEOptions,
  defaultEnabled: NamesIDEs = 'altair'
): Promise<void> {
  if (!userOptions) return;

  const { isAltairEnabled, isGraphiQLEnabled, altairOptions, graphiQLOptions } = parseIDEConfig(userOptions, defaultEnabled);

  await Promise.all([
    isAltairEnabled ? internal.handleAltair(altairOptions) : null,
    isGraphiQLEnabled
      ? internal.handleGraphiQL({
          ...graphiQLOptions,
          html: renderGraphiQL(graphiQLOptions),
        })
      : null,
  ]);
}
