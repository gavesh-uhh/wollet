import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import * as icons from "simple-icons";

const require = createRequire(import.meta.url);
const destination = join(process.cwd(), "public/logos/registry");
await mkdir(destination, { recursive: true });
const registry = Object.values(icons).filter(icon => icon?.slug && icon?.path)
  .sort((left, right) => left.title.localeCompare(right.title));
const entries = [];
for (const icon of registry) {
  if (!/^[a-z0-9_-]{1,100}$/.test(icon.slug) || !/^[a-f0-9]{6}$/i.test(icon.hex)) {
    throw new Error(`Invalid logo metadata: ${icon.title}`);
  }
  const filename = `${icon.slug}.svg`;
  // Generate only a single path. No remote references, scripts, or embedded fonts.
  const color = icon.hex.toUpperCase() === "FFFFFF" ? "454545" : icon.hex;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#${color}"><path d="${icon.path}"/></svg>`;
  await writeFile(join(destination, filename), svg);
  entries.push({ id: `registry:${icon.slug}#${encodeURIComponent(icon.title)}`, name: icon.title, src: `/logos/registry/${filename}` });
}
await writeFile(join(destination, "index.json"), JSON.stringify({ version: 1, source: "Simple Icons", entries }));
const packageRoot = dirname(require.resolve("simple-icons"));
await copyFile(join(packageRoot, "LICENSE.md"), join(destination, "LICENSE.txt"));
await copyFile(join(packageRoot, "DISCLAIMER.md"), join(destination, "DISCLAIMER.txt"));
console.log(`Logo registry ready (${entries.length} brands).`);
