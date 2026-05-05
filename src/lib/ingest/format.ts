/**
 * TM-103 — client-safe formatter for ingested URL context.
 *
 * Lives in its own file so the browser bundle never imports `cheerio`
 * (server-only). Both client (`useStudio`) and server (`api/ingest/url`)
 * can import this module.
 */

export interface IngestedContext {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  headlines: string[];
  /** Up to 6 hex color tokens scraped from inline style attrs. */
  palette: string[];
  fetchedAt: string;
}

/**
 * Format an ingested context for prompt injection. We append it as an
 * `[ATTACHED CONTEXT]` block — model treats it as supplementary, not the
 * primary instruction. Keeps prompt-cache key stable when the user reuses
 * the same URL.
 */
export function formatIngestForPrompt(ctx: IngestedContext): string {
  const lines: string[] = ['[ATTACHED CONTEXT — referenced URL]'];
  lines.push(`URL: ${ctx.url}`);
  if (ctx.title) lines.push(`Title: ${ctx.title}`);
  if (ctx.description) lines.push(`Description: ${ctx.description}`);
  if (ctx.headlines.length > 0) {
    lines.push(`Headlines: ${ctx.headlines.slice(0, 4).join(' | ')}`);
  }
  if (ctx.palette.length > 0) {
    lines.push(`Palette hints: ${ctx.palette.join(', ')}`);
  }
  if (ctx.image) lines.push(`Hero image: ${ctx.image}`);
  return lines.join('\n');
}
