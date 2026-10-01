import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const require = createRequire(import.meta.url);
const testsDir = fileURLToPath(new URL("../tests/frontend", import.meta.url));

export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  // jsdom tests load through the Vite server, which must be allowed to read them.
  server: { fs: { allow: [".", testsDir] } },
  // Tests live outside the frontend package; resolve its dependencies here.
  // Specifiers passed to vi.mock also need an alias so the test and the
  // mocked source resolve to the same module.
  resolve: {
    alias: {
      "midi-writer-js": require.resolve("midi-writer-js"),
      "jsdom": require.resolve("jsdom"),
      "@testing-library/react": require.resolve("@testing-library/react"),
      "next": fileURLToPath(new URL("node_modules/next", import.meta.url)),
      "react": fileURLToPath(new URL("node_modules/react", import.meta.url)),
      "react-dom": fileURLToPath(new URL("node_modules/react-dom", import.meta.url)),
    },
  },
  test: {
    // `dir`, not `root`: a root outside the working directory breaks loading
    // jsdom-environment test files.
    dir: testsDir,
    include: ["**/*.test.ts", "**/*.test.tsx"],
  },
});
