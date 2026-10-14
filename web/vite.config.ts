import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { appShellPlugin } from "./scripts/app-shell-plugin.ts";

export default defineConfig({
  plugins: [react(), tailwindcss(), appShellPlugin()],
  build: { target: ["chrome111", "edge111", "safari16.4", "firefox128"] },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    reporters: ["default", "junit"],
    outputFile: { junit: "test-results/unit.xml" },
  },
});
