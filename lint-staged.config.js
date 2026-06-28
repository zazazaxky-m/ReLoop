// @ts-check

/** @type {import('lint-staged').Config} */
const config = {
  "*.{ts,tsx}": ["eslint --fix", () => "tsc --noEmit --pretty"],
  "*.{js,jsx,json,md,yaml,yml}": ["eslint --fix"],
};

export default config;
