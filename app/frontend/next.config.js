const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Table URLs contain the QR token, so never leak them to other sites
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
];

export default {
  output: 'standalone', // a self-contained server for a small Docker image
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  // Local development only: send /api to the API on port 4000.
  // In AWS the load balancer routes /api/* to the API, so API_ORIGIN is never set there.
  async rewrites() {
    if (!process.env.API_ORIGIN) return [];
    return [{ source: '/api/:path*', destination: `${process.env.API_ORIGIN}/api/:path*` }];
  },
};