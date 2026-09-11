#!/usr/bin/env node
import { main } from '../lib/cli.mjs';

main(process.argv.slice(2)).catch((err) => {
  console.error(err);
  process.exit(2);
});
