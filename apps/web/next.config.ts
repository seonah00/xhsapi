import type { NextConfig } from 'next';

// React dev tooling needs eval(); production keeps it disallowed.
const scriptSrc = process.env.NODE_ENV === 'development' ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self' 'unsafe-inline'";

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
          {
            key: 'Content-Security-Policy',
            // No third-party origins: thumbnails are internal placeholders; providers are never called from the browser.
            value: `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; ${scriptSrc}; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
          },
        ],
      },
    ];
  },
};

export default config;
