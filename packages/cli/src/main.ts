import { run } from "./run.js";

const result = await run(process.argv.slice(2));
if (result.stderr) process.stderr.write(result.stderr);
if (result.stdout) process.stdout.write(result.stdout);
process.exit(result.code);
