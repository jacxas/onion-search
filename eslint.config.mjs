import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  // Keep the starter on the flat config export that actually runs under the pinned ESLint/Next toolchain.
  ...nextCoreWebVitals,
  globalIgnores([
    ".next/**", "out/**", "build/**", "next-env.d.ts",
    // legacy no migrado todavía (placeholders / python) — excluir del lint
    "frontend/**", "backend/**", "crawler/**", "db/**", "health_checker/**", "indexer/**",
    ".worker-build/**",
  ]),
]);
