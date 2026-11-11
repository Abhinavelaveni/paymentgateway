const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        // The checkout page's framing policy is set per request in src/proxy.ts so it follows
        // CHECKOUT_FRAME_ANCESTORS / YOUPI_MODE at runtime instead of at build time.
        source: "/admin/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default nextConfig;
