import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "coverage/**",
      "next-env.d.ts",
      "prisma/generated/**",
      "generated/**",
      "mobile/**",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Production CSP blocks inline style attributes (no 'unsafe-inline'),
      // and dev allows them, so they silently break only in production.
      "react/forbid-dom-props": ["error", { forbid: ["style"] }],
    },
  },
  {
    // next/og renders JSX to an image with Satori, not to the DOM.
    files: ["app/**/opengraph-image.tsx", "app/**/twitter-image.tsx"],
    rules: { "react/forbid-dom-props": "off" },
  },
];

export default eslintConfig;
