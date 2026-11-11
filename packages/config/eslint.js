import path from "node:path";
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const tsFiles = ["**/*.{ts,tsx}"];

export default defineConfig(
  globalIgnores([
    "**/node_modules/",
    "**/dist/",
    "**/.next/",
    "**/migrations/",
    "**/next-env.d.ts",
    ".npm-cache/",
  ]),
  js.configs.recommended,
  {
    files: tsFiles,
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: repoRoot },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },

  // Boundary: packages never import from apps.
  {
    files: ["packages/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@crm/api", "@crm/api/*", "@crm/web", "@crm/web/*", "**/apps/**"], message: "Packages must not import from apps." },
          ],
        },
      ],
    },
  },

  // Boundary: apps never import from other apps.
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["@crm/api", "@crm/api/*", "**/apps/api/**"], message: "The web app must call the API over HTTP, not import it." }] },
      ],
    },
  },

  // Boundary: a module may reach another module only through its index.ts.
  {
    files: ["apps/api/src/modules/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@crm/web", "@crm/web/*", "**/apps/web/**"], message: "The API must not import the web app." },
            { regex: "^\\.\\./[^./][^/]*/(?!index\\.js$)", message: "Import another module only through its index.js." },
          ],
        },
      ],
    },
  },
);
