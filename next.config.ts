import type { NextConfig } from "next";

import { buildSecurityHeaders } from "./lib/security-headers";



const nextConfig: NextConfig = {

  reactStrictMode: true,

  allowedDevOrigins: ["192.168.0.107", "10.8.0.3"],

  output: "standalone",

  async headers() {

    return [

      {

        source: "/:path*",

        headers: buildSecurityHeaders({

          hsts: process.env.NODE_ENV === "production",

        }),

      },

      {

        // Shared by the landing and the app (app/globals.css). Not
        // content-hashed, so a week rather than immutable.
        source: "/landing/fonts/:file*",

        headers: [{ key: "Cache-Control", value: "public, max-age=604800" }],

      },

    ];

  },

};



export default nextConfig;
