import { fileURLToPath } from "node:url";
import { version as reactVersion } from "react";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    settings: {
      // The test lint command runs from the repository root.
      next: { rootDir: fileURLToPath(new URL(".", import.meta.url)) },
      react: { version: reactVersion },
    },
  },
  {
    // Unused state or imports usually mean UI was dropped (see #112), so fail
    // CI instead of warning.
    rules: { "@typescript-eslint/no-unused-vars": "error" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
