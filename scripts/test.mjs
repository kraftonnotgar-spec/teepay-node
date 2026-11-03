// Runs every tests/*.test.mjs file with node:test (explicit file list works on Node 18 through 22+).
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
const files = readdirSync(new URL('../tests', import.meta.url)).filter(f => /\.test\.(mjs|cjs)$/.test(f)).sort().map(f => `tests/${f}`);
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
