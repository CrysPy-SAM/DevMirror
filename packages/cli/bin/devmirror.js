#!/usr/bin/env node

/**
 * DevMirror CLI Binary
 */

import { runCli } from '../dist/cli.js';

runCli(process.argv.slice(2)).catch((err) => {
  console.error('\nFatal Error:', err);
  process.exit(1);
});
