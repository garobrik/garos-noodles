// Environment: server
// Cumulative: applies to all pages, cannot be overridden.
// Preload fonts so they download in parallel with CSS/JS, avoiding
// FOUT pop-in when `font-display: swap` kicks in on first paint.
export function Head() {
  return (
    <>
      <link
        rel="preload"
        href="/fonts/fraunces-latin-full-normal.woff2"
        as="font"
        type="font/woff2"
        crossOrigin="anonymous"
      />
      <link
        rel="preload"
        href="/fonts/fraunces-latin-full-italic.woff2"
        as="font"
        type="font/woff2"
        crossOrigin="anonymous"
      />
      <link
        rel="preload"
        href="/fonts/literata-latin-opsz-normal.woff2"
        as="font"
        type="font/woff2"
        crossOrigin="anonymous"
      />
    </>
  );
}
