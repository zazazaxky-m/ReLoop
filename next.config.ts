import type { NextConfig } from "next";

import { buildSecurityHeaders } from "./lib/security-headers";



const nextConfig: NextConfig = {

  reactStrictMode: true,

  allowedDevOrigins: ["192.168.0.107"],

  output: "standalone",

  async headers() {

    return [

      {

        source: "/:path*",

        headers: buildSecurityHeaders({

          hsts: process.env.NODE_ENV === "production",

        }),

      },

    ];

  },

};



export default nextConfig;
