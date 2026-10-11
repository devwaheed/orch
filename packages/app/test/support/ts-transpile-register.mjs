// Preload for `node --import`: registers the transpiling hooks in ts-transpile.mjs.
import { register } from 'node:module';

register(new URL('./ts-transpile.mjs', import.meta.url));
