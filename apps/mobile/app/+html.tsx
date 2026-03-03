import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

/**
 * Base HTML template for server-side rendering.
 *
 * This file provides the root HTML structure for all web pages.
 * It's required when using server output mode in Expo Router.
 *
 * @see https://docs.expo.dev/router/reference/static-rendering/#root-html
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />

        {/* Preconnect to fonts for performance */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />

        {/* Theme color for mobile browsers */}
        <meta name="theme-color" content="#D4A574" />

        {/*
          Disable body scrolling on web. This makes ScrollView components work better.
          However, body scrolling is often preferred for SEO and accessibility.
          The ScrollViewStyleReset component adds styles to prevent scroll issues.
        */}
        <ScrollViewStyleReset />

        {/* Base styles for web */}
        <style dangerouslySetInnerHTML={{ __html: responsiveBackground }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

/**
 * Reset default body styles and add responsive background.
 * Using the same warm color palette as the landing page.
 */
const responsiveBackground = `
body {
  margin: 0;
  padding: 0;
  background-color: #FDF8F3;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* Prevent horizontal overflow */
html, body, #root {
  overflow-x: hidden;
}

/* Reset for better cross-browser consistency */
*, *::before, *::after {
  box-sizing: border-box;
}

/* Smooth scrolling */
html {
  scroll-behavior: smooth;
}

/* Focus visible for accessibility */
:focus-visible {
  outline: 2px solid #D4A574;
  outline-offset: 2px;
}
`;
