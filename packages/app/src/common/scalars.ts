import { createModule, gql, Module } from 'graphql-modules';
import { resolvers as scalarResolvers, typeDefs as scalarTypeDefs } from 'graphql-scalars';

import type { IScalarTypeResolver } from '@graphql-tools/utils';
import type { DocumentNode } from 'graphql';

export type ScalarsConfig = '*' | { [k in keyof typeof scalarResolvers]?: boolean | 1 | 0 } | Array<keyof typeof scalarResolvers>;

export type ScalarResolvers = Record<string, IScalarTypeResolver>;

export interface ScalarsModule {
  typeDefs: DocumentNode;
  module: Module;
  resolvers: ScalarResolvers;
}

export function createScalarsModule(scalars?: ScalarsConfig): ScalarsModule | null {
  if (!scalars) return null;

  if (scalars === '*') {
    const allScalarsNames = scalarTypeDefs.join('\n');

    const typeDefs = gql(allScalarsNames);

    const resolvers = scalarResolvers;
    return {
      typeDefs,
      module: createModule({
        id: 'scalars',
        typeDefs,
        resolvers,
      }),
      resolvers,
    };
  }

  if (Array.isArray(scalars)) {
    const scalarNames = scalars.reduce((acum, scalarName) => {
      if (scalarName in scalarResolvers) acum.push(`scalar ${scalarName}\n`);
      return acum;
    }, [] as string[]);

    if (!scalarNames.length) return null;

    const typeDefs = gql(scalarNames.join(''));

    const resolvers = scalars.reduce((acum, scalarName) => {
      const resolver = (scalarResolvers as ScalarResolvers)[scalarName];

      if (resolver) acum[scalarName] = resolver;
      return acum;
    }, {} as ScalarResolvers);

    const module = createModule({
      id: 'scalars',
      typeDefs,
      resolvers,
    });

    return {
      typeDefs,
      module,
      resolvers,
    };
  }

  const scalarNames = Object.entries(scalars).reduce((acum, [scalarName, value]) => {
    if (value && scalarName in scalarResolvers) acum.push(`scalar ${scalarName}\n`);
    return acum;
  }, [] as string[]);

  if (!scalarNames.length) return null;

  const typeDefs = gql(scalarNames.join(''));

  const resolvers = Object.keys(scalars).reduce((acum, scalarName) => {
    const resolver = (scalarResolvers as ScalarResolvers)[scalarName];

    if (resolver) acum[scalarName] = resolver;
    return acum;
  }, {} as ScalarResolvers);

  const module = createModule({
    id: 'scalars',
    typeDefs,
    resolvers,
  });

  return {
    typeDefs,
    module,
    resolvers,
  };
}
