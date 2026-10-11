#!/usr/bin/env node
import { runStdioServer } from './server.js';

runStdioServer().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
