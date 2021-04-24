import { createModule, gql, Module } from 'graphql-modules';
import { resolvers as scalarResolvers, typeDefs as scalarTypeDefs } from 'graphql-scalars';

import type { GraphQLScalarType } from 'graphql';

export type ScalarsConfig = '*' | { [k in keyof typeof scalarResolvers]?: boolean | 1 | 0 } | Array<keyof typeof scalarResolvers>;

export function createScalarsModule(scalars?: ScalarsConfig): Module | void {
  if (!scalars) return;

  if (scalars === '*') {
    const allScalarsNames = scalarTypeDefs.join('\n');

    return createModule({
      id: 'scalars',
      typeDefs: gql(allScalarsNames),
      resolvers: scalarResolvers,
    });
  }

  if (Array.isArray(scalars)) {
    const scalarNames = scalars.reduce((acum, scalarName) => {
      if (scalarName && scalarName in scalarResolvers) acum.push(`scalar ${scalarName}\n`);
      return acum;
    }, [] as string[]);

    if (!scalarNames.length) return;

    return createModule({
      id: 'scalars',
      typeDefs: gql(scalarNames),
      resolvers: Object.keys(scalars).reduce((acum, scalarName) => {
        const resolver = (scalarResolvers as Record<string, GraphQLScalarType>)[scalarName];

        if (resolver) acum[scalarName] = resolver;
        return acum;
      }, {} as Record<string, any>),
    });
  }

  const scalarNames = Object.entries(scalars).reduce((acum, [scalarName, value]) => {
    if (value && scalarName in scalarResolvers) acum.push(`scalar ${scalarName}\n`);
    return acum;
  }, [] as string[]);

  if (!scalarNames.length) return;

  return createModule({
    id: 'scalars',
    typeDefs: gql(scalarNames),
    resolvers: Object.keys(scalars).reduce((acum, scalarName) => {
      const resolver = (scalarResolvers as Record<string, GraphQLScalarType>)[scalarName];

      if (resolver) acum[scalarName] = resolver;
      return acum;
    }, {} as Record<string, any>),
  });
}
