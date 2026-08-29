import type { StorybookConfig } from "@storybook/angular";
const config: StorybookConfig = {
  stories: ["../src/**/*.mdx", "../src/**/*.stories.@(js|jsx|ts|tsx)"],
  staticDirs: [{ from: '../src/assets', to: '/assets' }],
  addons: [
    // SB9: addon-essentials (controls, actions, viewport, …) and addon-interactions
    // are built into core. addon-docs provides docs/autodocs and the MDX blocks.
    "@storybook/addon-links",
    "@storybook/addon-docs",
  ],
  framework: {
    name: "@storybook/angular",
    options: {},
  },
  // webcrypto-liner's build references node's `util`, and webpack 5 stopped polyfilling node core
  // modules. The Angular application builder handles this itself; Storybook's webpack does not, so
  // it is declared here (yourphr#482). `false` supplies an empty module rather than pulling a
  // browser polyfill in: the code path that would use it is node-only and never taken in a browser.
  webpackFinal: async (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.fallback = { ...(config.resolve.fallback ?? {}), util: false };
    return config;
  },
};
export default config;
