import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const stateDir = join(scriptDir, "..", ".wrangler", "state");

await rm(stateDir, { recursive: true, force: true });

console.log(`Local D1 state removed: ${stateDir}`);
console.log("Run `npm run db:migrate:local` to rebuild the schema.");
