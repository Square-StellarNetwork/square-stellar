import type { NextConfig } from "next";

/**
 * A static export, served by any file server.
 *
 * `APP_BASE_PATH` is for a host that serves the app from a sub-path rather
 * than from a domain root — GitHub Pages serves a project site at
 * `/<repository>`, so the deploy workflow sets it to `/square-stellar`.
 * Next then rewrites its own links and asset URLs to match. It is empty
 * everywhere else, which is `npm run dev` and any deployment with a domain
 * of its own, so nothing changes for them.
 */
const basePath = (process.env["APP_BASE_PATH"] ?? "").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
  reactStrictMode: true,
  ...(basePath === "" ? {} : { basePath, assetPrefix: basePath }),
};

export default nextConfig;
