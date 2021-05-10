import { renderGraphiQL } from 'graphql-helix';

import { cleanObject } from '../utils/object.js';

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

export function parseIDEConfig(userOptions: IDEOptions, graphqlPath?: string): IDEConfig {
  const options = typeof userOptions === 'boolean' ? { altair: true, graphiql: true } : userOptions;

  const altairOptions: AltairOptions & { path: string } = {
    path: '/altair',
    endpointURL: graphqlPath,
    ...(typeof options.altair === 'boolean' ? {} : cleanObject(options.altair) || {}),
  };
  const graphiQLOptions: GraphiQLOptions & { path: string } = {
    path: '/graphiql',
    endpoint: graphqlPath,
    ...(typeof options.graphiql === 'boolean' ? {} : cleanObject(options.graphiql) || {}),
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
  graphqlPath: string,
  internal: InternalIDEOptions
): Promise<void> {
  if (!userOptions) return;

  const { isAltairEnabled, isGraphiQLEnabled, altairOptions, graphiQLOptions } = parseIDEConfig(userOptions, graphqlPath);

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