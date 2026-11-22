import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import fs from 'node:fs';
import path from 'node:path';

// https://vitejs.dev/config/
export default defineConfig({
  base: '/workerman-solver/',
  build: {
    //minify: false,
    emptyOutDir: false,
  },
  plugins: [vue()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
