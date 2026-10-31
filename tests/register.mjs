// Lets `node --test` run the app's TypeScript without extra dependencies: resolves the "@/"
// path alias and extensionless relative imports (as Next.js does) to .ts files.
// Used by `npm test`, together with --experimental-strip-types and --conditions=react-server
// (the latter makes the "server-only" package a no-op outside Next.js).
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(`
import { existsSync } from "node:fs";
const root = ${JSON.stringify(new URL("../", import.meta.url).href)};
export async function resolve(specifier, context, next) {
  let spec = specifier.startsWith("@/") ? new URL(specifier.slice(2), root).href : specifier;
  const relative = spec.startsWith("file:") || spec.startsWith("./") || spec.startsWith("../");
  if (relative && !/\\.[cm]?[jt]sx?$/.test(spec)) {
    for (const ext of [".ts", ".tsx", "/index.ts"]) {
      const candidate = new URL(spec + ext, context.parentURL);
      if (existsSync(candidate)) return next(candidate.href, context);
    }
  }
  return next(spec, context);
}
`),
);
