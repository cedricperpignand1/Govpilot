/**
 * Domain extraction utility — single canonical source.
 * Imported by db.ts (re-exported for backward compat) and all new service files.
 */

/**
 * Strips protocol, www prefix, path, query, and port from a URL string.
 * Returns the bare hostname, e.g. "https://www.example.com/path" → "example.com".
 * Returns null if the input is empty or unparseable.
 */
export function extractDomain(website: string | null | undefined): string | null {
  if (!website) return null;
  try {
    let url = website.trim();
    if (!url.startsWith("http")) url = "https://" + url;
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./i, "").toLowerCase() || null;
  } catch {
    return null;
  }
}
