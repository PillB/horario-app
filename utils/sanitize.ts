/**
 * Display-string sanitisation utilities.
 *
 * These functions are intentionally minimal — they protect against stored XSS
 * when user-supplied strings are later rendered in HTML surfaces (web admin panels,
 * email notifications, PDF exports). React Native's Text component is not vulnerable
 * to HTML injection, but defensive encoding is cheap and future-proofs the codebase.
 */

/**
 * HTML-encodes the five characters that are significant in HTML/XML and strips
 * invisible / control characters that have no place in human-readable display strings.
 *
 * Use this on any user-supplied string before persisting it to the database when it
 * may later be rendered in an HTML context.
 */
export function sanitizeDisplayString(value: string): string {
  return (
    value
      // HTML-encode the five dangerous characters
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      // Strip C0/C1 control chars except HT (0x09) and LF (0x0A)
      .replace(/[\x00-\x08\x0B-\x1F\x7F-\x9F]/g, '')
      // Strip Unicode zero-width / invisible characters
      .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '')
  );
}

/**
 * Returns an error message if `value` contains HTML-significant or control characters,
 * or `null` if the value is safe to display.
 *
 * Use this as a fast validation gate before writing to the DB — complements
 * `sanitizeDisplayString` for cases where you want to reject rather than silently fix.
 */
export function validateDisplayString(value: string, fieldLabel: string): string | null {
  if (/<|>|&[a-z]+;/i.test(value)) {
    return `${fieldLabel} must not contain HTML characters.`;
  }
  if (/[\x00-\x08\x0B-\x1F\x7F-\x9F]/.test(value)) {
    return `${fieldLabel} contains invalid characters.`;
  }
  return null;
}
