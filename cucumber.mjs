// Cucumber (BDD) configuration. Run with `npm run test:bdd` (offline scenarios)
// or `npm run test:bdd:live` (real GLM calls; needs OPENROUTER_API_KEY).
export default {
  paths: ["features/**/*.feature"],
  import: ["features/support/**/*.ts", "features/steps/**/*.ts"],
  format: ["progress"],
  tags: "not @live",
};

export const live = {
  paths: ["features/**/*.feature"],
  import: ["features/support/**/*.ts", "features/steps/**/*.ts"],
  format: ["progress"],
  tags: "@live",
};
