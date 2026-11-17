import { readdir, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { resolve } from "node:path";
await rm("dist", { recursive: true, force: true });
async function build(dir) {
  for (const f of await readdir("src/" + dir, { withFileTypes: true })) {
    const p = dir + "/" + f.name;
    if (f.isDirectory()) {
      await build(p);
      continue;
    }
    let text = await readFile("src/" + p);
    let target = "dist/" + p;
    if (p.endsWith(".ts")) {
      text = Buffer.from(
        stripTypeScriptTypes(text.toString()).replaceAll(
          /(from\s+['"][^'"]+)\.ts(['"])/g,
          "$1.js$2",
        ),
      );
      target = target.replace(/\.ts$/, ".js");
    }
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, text);
  }
}
await build("");
console.log("Built server, client, and shared modules into dist/");
