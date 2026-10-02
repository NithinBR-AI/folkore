import { build } from "esbuild";
import { copyFile, mkdir, cp, rm } from "node:fs/promises";
import { execSync } from "node:child_process";

await rm("dist-lambda", { recursive: true, force: true });
await mkdir("dist-lambda", { recursive: true });

// Copy bundled web UI into dist-lambda so Lambda can serve it
await copyFile("dist/mcp-app.html", "dist-lambda/mcp-app.html");

// Copy prompt files — agents load these at runtime via fs.readFile
await cp("src/server/prompts", "dist-lambda/prompts", { recursive: true });
console.log("✓ Prompt files copied to dist-lambda/prompts");

// Bundle server into single ESM file with CJS interop shim
await build({
  entryPoints: ["src/server/lambda.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: "dist-lambda/index.mjs",
  external: [
    // AWS SDK is available in Lambda runtime — exclude to keep bundle small
    "@aws-sdk/*",
  ],
  define: {
    // Provide import.meta.url for all bundled modules so fileURLToPath works
    "import.meta.url": JSON.stringify("file:///var/task/index.mjs"),
  },
  banner: {
    // CJS interop shim — allows dynamic require() inside ESM bundle
    js: `
import { createRequire } from "module";
const require = createRequire(import.meta.url);
// Folkore MCP Server — Lambda bundle
`,
  },
});

console.log("✓ Lambda bundle written to dist-lambda/index.mjs");

// Zip for upload
execSync("powershell Compress-Archive -Force -Path dist-lambda\\* -DestinationPath folkore-lambda.zip");
console.log("✓ folkore-lambda.zip ready for upload");
