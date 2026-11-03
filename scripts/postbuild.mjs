// Mark each build's module format so Node and TypeScript read dist/esm as ESM and dist/cjs as CommonJS.
import { writeFileSync } from 'node:fs';
writeFileSync(new URL('../dist/esm/package.json', import.meta.url), JSON.stringify({ type: 'module' }) + '\n');
writeFileSync(new URL('../dist/cjs/package.json', import.meta.url), JSON.stringify({ type: 'commonjs' }) + '\n');
