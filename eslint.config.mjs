import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  globalIgnores(["dist/**", ".next/**", ".vinext/**"]),
  ...nextVitals,
  ...nextTs,
]);
