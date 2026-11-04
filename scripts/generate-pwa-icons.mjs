import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createElement as h } from "react";
import { ImageResponse } from "next/og.js";

const logo = `data:image/png;base64,${(await readFile(new URL("../public/favicon.png", import.meta.url))).toString("base64")}`;
const directory = new URL("../public/pwa/", import.meta.url);
await mkdir(directory, { recursive: true });
for (const [name, size] of [["apple-touch-icon.png", 180], ["icon-192.png", 192], ["icon-512.png", 512]]) {
  const response = new ImageResponse(h("div", {
    style: { width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#07172d" },
  }, h("img", { src: logo, width: Math.round(size * 0.76), height: Math.round(size * 0.76) })), { width: size, height: size });
  await writeFile(new URL(name, directory), Buffer.from(await response.arrayBuffer()));
}
