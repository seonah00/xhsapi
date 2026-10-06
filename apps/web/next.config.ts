import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@xhs/domain', '@xhs/providers', '@xhs/security'],
  serverExternalPackages: ['pg'],
  poweredByHeader: false,
  agentRules: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          // HTTPS deployments only (a local http server must not pin HSTS on localhost).
          ...(process.env.APP_BASE_URL?.startsWith('https://') ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }] : []),
        ],
      },
      {
        // Pages get a per-request nonce CSP from src/proxy.ts; JSON/file responses never need scripts.
        source: '/api/:path*',
        headers: [{ key: 'Content-Security-Policy', value: "default-src 'none'; frame-ancestors 'none'; sandbox" }],
      },
    ];
  },
};

export default config;
