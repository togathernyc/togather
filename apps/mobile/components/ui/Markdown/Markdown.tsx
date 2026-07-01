/**
 * Markdown - Rich markdown renderer for the togather app.
 *
 * Wraps `react-native-markdown-display` with themed styles and custom render
 * rules (see `markdownRules.tsx`). Handles headers, bold/italic, lists, links,
 * blockquotes, code, and horizontal rules with the app theme.
 *
 * ── MEDIA / VIDEO CONVENTIONS ────────────────────────────────────────────────
 *
 * Images:
 *   Standard markdown image syntax, but the URL may be an `r2:` storage path so
 *   Cloudflare transforms work through `AppImage`:
 *
 *       ![alt text](r2:chat/uuid-photo.jpg)
 *       ![alt text](https://example.com/photo.jpg)
 *
 * Videos:
 *   Use the `!video[...](...)` extension. It looks like an image token with a
 *   `!video` marker instead of `!`. The URL is an `r2:` path or an http(s) URL:
 *
 *       !video[caption](r2:chat/uuid-clip.mp4)
 *
 *   The MarkdownEditor emits this token when you insert a video. Under the hood
 *   it is normalized to a standard image token whose src is prefixed with
 *   `video:` (e.g. `![caption](video:r2:chat/uuid-clip.mp4)`) so the parser
 *   accepts it; the renderer then routes any src that is `video:`-prefixed or
 *   ends in a video extension (.mp4/.mov/.m4v/.webm) to `VideoPlayer`.
 *
 * Task lists:
 *   GitHub-style task list items render as read-only checkbox rows:
 *
 *       - [ ] not done
 *       - [x] done
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo } from 'react';
import MarkdownDisplay from 'react-native-markdown-display';
import { useTheme } from '@hooks/useTheme';
import { createMarkdownRules, createMarkdownStyles } from './markdownRules';

interface MarkdownProps {
  source: string;
}

/**
 * Rewrite the `!video[alt](url)` extension into a standard image token whose
 * src is `video:`-prefixed, which the render rules route to `VideoPlayer`.
 *
 * Doing this as a source transform (rather than a markdown-it plugin) keeps the
 * parser configuration stock and the behavior easy to reason about.
 */
export function preprocessMarkdown(source: string): string {
  if (!source) return '';
  // !video[alt](url)  ->  ![alt](video:url)
  return source.replace(
    /!video\[([^\]]*)\]\(([^)]+)\)/g,
    (_match, alt: string, url: string) => `![${alt}](video:${url.trim()})`,
  );
}

/**
 * Renders markdown `source` with the app theme and custom media handling.
 */
export function Markdown({ source }: MarkdownProps) {
  const { colors } = useTheme();

  const rules = useMemo(() => createMarkdownRules(colors), [colors]);
  const styles = useMemo(() => createMarkdownStyles(colors), [colors]);
  const processed = useMemo(() => preprocessMarkdown(source), [source]);

  return (
    <MarkdownDisplay rules={rules} style={styles}>
      {processed}
    </MarkdownDisplay>
  );
}
