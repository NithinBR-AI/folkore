/**
 * PII scrubbing — strips sensitive patterns from memory content before
 * it is written to S3 or stored in DynamoDB.
 *
 * Patterns removed:
 *   - Phone numbers (US and international formats)
 *   - Email addresses
 *   - SSNs (###-##-####)
 *   - Credit/debit card numbers (13–16 digit sequences)
 *   - Passport / ID numbers (letter + 6–9 digits)
 */

const RULES: Array<{ pattern: RegExp; replacement: string }> = [
  // Phone numbers — US (with/without country code) and international
  // Handles: 555-123-4567, (555) 123-4567, 555.123.4567, +1 555-123-4567
  {
    pattern: /(\+?1[\s.-]?)?(\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}/g,
    replacement: "[PHONE REDACTED]",
  },
  // Email addresses
  {
    pattern: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
    replacement: "[EMAIL REDACTED]",
  },
  // SSN — ###-##-#### or ######### (9 digits)
  {
    pattern: /\b\d{3}-\d{2}-\d{4}\b|\b\d{9}\b/g,
    replacement: "[SSN REDACTED]",
  },
  // Credit/debit card numbers — 13–16 consecutive digits (not already caught by SSN)
  {
    pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{1,4}\b/g,
    replacement: "[CARD REDACTED]",
  },
  // Passport / national ID — one or two letters followed by 6–9 digits
  {
    pattern: /\b[A-Z]{1,2}\d{6,9}\b/g,
    replacement: "[ID REDACTED]",
  },
];

/**
 * Returns a copy of `text` with all PII patterns replaced.
 * Safe to call on any string — returns the original if no patterns match.
 */
export function scrubPii(text: string): string {
  return RULES.reduce((t, { pattern, replacement }) => t.replace(pattern, replacement), text);
}

/**
 * Scrubs PII from all text fields of a memory before storage.
 * Returns a new object — never mutates the input.
 */
export function scrubMemory<T extends { who: string; what: string; when: string; tags: string[] }>(
  memory: T,
): T {
  return {
    ...memory,
    who:  scrubPii(memory.who),
    what: scrubPii(memory.what),
    when: scrubPii(memory.when),
    tags: memory.tags.map(scrubPii),
  };
}
