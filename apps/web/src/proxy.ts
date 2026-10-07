import { NextResponse, type NextRequest } from 'next/server';

/**
 * Per-request CSP nonce (no 'unsafe-inline' for scripts). Next.js reads the nonce
 * from the request CSP header and applies it to its own scripts during dynamic SSR.
 * style-src keeps 'unsafe-inline' for style attributes (no user HTML is rendered).
 */
export function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const dev = process.env.NODE_ENV === 'development';
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    // Note covers load straight from Xiaohongshu's image CDNs (same list as XHS_IMAGE_DOMAINS in @xhs/security).
    "img-src 'self' data: https://*.rednotecdn.com https://*.xhscdn.com https://*.xhscdn.net",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!api|_next/static|_next/image|icon.svg).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
