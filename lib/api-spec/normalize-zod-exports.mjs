import { readFile, writeFile } from "node:fs/promises";

const indexPath = new URL("../api-zod/src/index.ts", import.meta.url);
const source = await readFile(indexPath, "utf8");
const normalized = source.replace(/\nexport \* from ['"]\.\/generated\/types['"];?\s*$/m, "\n");

if (normalized !== source) {
  await writeFile(indexPath, normalized);
}