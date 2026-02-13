module.exports = [
  {
    ignores: [
      "**/dist/**",
      "**/bundle/**",
      "**/node_modules/**",
      "**/*.d.ts",
      "**/*.tsbuildinfo",
      "**/.reporag/**",
      "package-lock.json",
    ],
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "commonjs",
    },
    rules: {},
  },
];
