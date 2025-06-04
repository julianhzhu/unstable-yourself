import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactStrictMode: true,
  images: {
    domains: [
      "raw.githubusercontent.com",
      "ipfs.io",
      "nftstorage.link",
      "i.imgur.com",
      "arweave.net",
      "static.jup.ag",
    ],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.ipfs.nftstorage.link",
      },
    ],
  },
};

export default nextConfig;
