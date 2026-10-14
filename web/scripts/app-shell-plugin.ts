import type { Plugin } from "vite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export function appShellPlugin(): Plugin {
  return {
    name: "sikmulwang-app-shell",
    apply: "build",
    generateBundle(_options, bundle) {
      const publicFiles = [
        "manifest.webmanifest",
        "icons/icon.svg",
        "icons/icon-192.png",
        "icons/icon-512.png",
        "icons/maskable-512.png",
        "icons/apple-touch-icon.png",
      ];
      const files = [
        "/",
        ...Object.keys(bundle).map((file) => `/${file}`),
        ...publicFiles.map((file) => `/${file}`),
      ];
      const digest = createHash("sha256");
      digest.update(readFileSync("index.html"));
      for (const file of Object.values(bundle))
        digest.update(file.type === "chunk" ? file.code : file.source);
      for (const file of publicFiles)
        digest.update(readFileSync(`public/${file}`));
      const template = readFileSync("scripts/sw-template.js", "utf8");
      digest.update(template);
      const version = digest.digest("hex").slice(0, 16);
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: template
          .replace("__VERSION__", version)
          .replace("__FILES__", JSON.stringify(files)),
      });
    },
  };
}
