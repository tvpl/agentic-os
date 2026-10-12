// ESLint 9 flat config. Type-unaware on purpose: fast enough for pre-commit and CI.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "build/**",
      "release/**",
      "**/node_modules/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "tests/.tmp/**",
      "docs/**",
      "artifacts/**",
      "memory/**",
      "config/**",
      "logs/**",
      "**/*.tsbuildinfo",
      // the desktop shell: Cargo's output and the payload (a minified bundle) are not source
      "apps/desktop/target/**",
      "apps/desktop/payload/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Backend, CLI, tests and config scripts run on Node.
    files: ["**/*.{js,mjs,cjs,ts}"],
    languageOptions: {
      globals: { ...globals.node, ...globals.es2021 },
    },
  },
  {
    files: ["**/*.{ts,tsx,js,mjs,cjs}"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/consistent-type-imports": ["warn", { fixStyle: "inline-type-imports" }],
      "no-console": "off",
      "prefer-const": "error",
      eqeqeq: ["error", "smart"],
    },
  },
  {
    // Command Centre: browser globals, hooks discipline and accessibility.
    files: ["apps/command-centre/src/**/*.{ts,tsx}"],
    ...jsxA11y.flatConfigs.recommended,
    languageOptions: {
      ...jsxA11y.flatConfigs.recommended.languageOptions,
      globals: { ...globals.browser, ...globals.es2021 },
    },
  },
  {
    files: ["apps/command-centre/src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // Scrollable read-only regions (code viewers, logs) must be keyboard focusable.
      "jsx-a11y/no-noninteractive-tabindex": ["error", { roles: ["tabpanel", "region"] }],
    },
  },
  {
    // Command Centre HTTP goes through `request()` in api.ts, which refuses a
    // settings write carrying a UI preference key (.specs/features/preferencias-ui, C32).
    files: ["apps/command-centre/src/**/*.{ts,tsx}"],
    ignores: ["apps/command-centre/src/api.ts", "apps/command-centre/src/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "fetch",
          message: "Call the API through `api` (api.ts), whose request() guards the settings route.",
        },
        { name: "XMLHttpRequest", message: "Call the API through `api` (api.ts)." },
      ],
      "no-restricted-properties": [
        "error",
        { object: "window", property: "fetch", message: "Call the API through `api` (api.ts)." },
        { object: "globalThis", property: "fetch", message: "Call the API through `api` (api.ts)." },
        { object: "self", property: "fetch", message: "Call the API through `api` (api.ts)." },
        { object: "navigator", property: "sendBeacon", message: "Call the API through `api` (api.ts)." },
      ],
    },
  },
  {
    // Plain scripts served as-is by the Command Centre (boot recovery, service worker).
    files: ["apps/command-centre/public/**/*.js"],
    languageOptions: { globals: { ...globals.browser, ...globals.serviceworker, ...globals.es2021 } },
  },
  {
    // The shell's own two screens: plain scripts loaded by the webview (apps/desktop/ui).
    files: ["apps/desktop/ui/**/*.js"],
    languageOptions: { globals: { ...globals.browser, ...globals.es2021 } },
  },
  {
    // Playwright scripts evaluate callbacks inside the browser page.
    files: ["tests/e2e/**/*.{ts,mjs}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    // Tests are allowed to poke at internals.
    files: ["tests/**/*.ts", "**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
