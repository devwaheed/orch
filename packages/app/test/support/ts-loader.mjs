// Test-only loader: lets a child Node process import the repo's TypeScript
// sources. Node strips the types; this maps `./x.js` specifiers to `./x.ts`.
import { register } from 'node:module';

register(new URL('./ts-resolve.mjs', import.meta.url));
