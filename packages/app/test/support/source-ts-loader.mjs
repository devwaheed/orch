import { register } from 'node:module';

register(new URL('./ts-transpile.mjs', import.meta.url));
