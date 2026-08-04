# Browser security policy

Outflow applies its browser protections centrally before static files, API
parsers, authentication and route middleware. This ensures successful,
unauthorized and error responses receive the same baseline headers.

## Content Security Policy

The default source is the application origin. Frames, plugins, base elements
and cross-origin form submissions are denied. Network connections are limited
to the application origin. Images additionally allow `data:` and `blob:` URLs
because profile photographs are stored as data URLs.

Chart.js remains pinned to the existing jsDelivr URL. Its exact URL, rather
than the whole CDN origin, is the only external script source.
Cross-Origin-Embedder-Policy is intentionally omitted:
`require-corp` would make that existing cross-origin dependency browser-header
dependent and could stop charts rendering. Cross-Origin-Opener-Policy and
Cross-Origin-Resource-Policy remain enabled.

The legacy vanilla-JS renderers still emit inline event-handler attributes and
inline style attributes. CSP therefore permits `unsafe-inline` only through
`script-src-attr` and the style directives. Inline `<script>` elements are not
permitted. Removing the event-handler allowance requires replacing every
generated handler with programmatic event binding and should be completed as a
separate behaviour-preserving frontend refactor.

Production responses add `upgrade-insecure-requests`. HSTS is emitted only in
production so local HTTP development remains usable. It deliberately does not
claim unrelated subdomains because Outflow cannot know whether a self-hosted
parent domain serves every subdomain over HTTPS.

## Caching

All API responses and the HTML application shell use `no-store`. This prevents
authenticated financial data and login state from being retained in HTTP
caches. JavaScript, CSS, images and other public static assets use mandatory
revalidation because their filenames are not content hashed.

## Other protections

Outflow disables the Express identification header and dynamic ETags. It also
sets protections against framing, MIME sniffing, referrer leakage, unnecessary
browser permissions, cross-origin window access, DNS prefetching and legacy
cross-domain policy files.
