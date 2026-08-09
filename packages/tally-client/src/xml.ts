/** Escape a value for embedding in Tally request XML. */
export function esc(val: string | number | undefined | null): string {
  if (val === undefined || val === null) return '';
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Format a date as Tally's YYYYMMDD. */
export function fmtTallyDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/**
 * Strip characters and numeric entity references that are illegal in XML 1.0.
 * Tally emits control chars (e.g. &#4;) inside narrations, which break parsers.
 */
export function sanitizeXml(raw: string): string {
  return raw
    .replace(/&#(x?)([0-9a-fA-F]+);/g, (match, isHex: string, digits: string) => {
      const code = parseInt(digits, isHex ? 16 : 10);
      if (Number.isNaN(code)) return '';
      // Tab (9), LF (10), CR (13) and everything >= 32 are legal.
      return code === 9 || code === 10 || code === 13 || code >= 32 ? match : '';
    })
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}
