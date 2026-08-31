import { defineConfig } from 'vite';

// The zip host mounts the build under a content-addressed prefix,
// so all asset paths must be relative to the served root.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsInlineLimit: 100000000,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
