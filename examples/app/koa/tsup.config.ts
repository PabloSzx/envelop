export const tsup: import('tsup').Options = {
  entryPoints: ['src/index.ts'],
  sourcemap: true,
  splitting: true,
  format: ['cjs', 'esm'],
  target: 'es2020',
  silent: true,
  clean: true,
};
