/**
 * Rendering of the `{{variable}}` placeholders used by DM templates, public
 * reply templates and resource bodies.
 *
 * Contract (covered by src/services/automation/template.test.ts):
 *  - Known placeholders are substituted; a missing value renders as ''.
 *  - Unknown placeholders are left verbatim, so a typo is visible in the sent
 *    message instead of silently deleting words from the author's copy.
 *  - The rendered text is capped at Meta's 1,000-byte UTF-8 limit without ever
 *    cutting a multi-byte character in half.
 */

export type TemplateVariables = {
  username?: string | null;
  resourceUrl?: string | null;
  resourceName?: string | null;
  igUsername?: string | null;
  commentText?: string | null;
};

export const TEMPLATE_VARIABLES = [
  'username',
  'resource_url',
  'resource_name',
  'ig_username',
  'comment_text',
] as const;

/** Meta rejects message text above 1,000 UTF-8 bytes. */
export const MAX_RENDERED_MESSAGE_BYTES = 1_000;

function valueFor(name: string, vars: TemplateVariables): string {
  switch (name) {
    case 'username': return vars.username || '';
    case 'resource_url': return vars.resourceUrl || '';
    case 'resource_name': return vars.resourceName || '';
    case 'ig_username': return vars.igUsername || '';
    case 'comment_text': return vars.commentText || '';
    default: return '';
  }
}

/** Truncates on a UTF-8 boundary so the message is never corrupted mid-character. */
export function truncateUtf8(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  const buffer = Buffer.from(text, 'utf8');
  let end = maxBytes;
  // Back up over UTF-8 continuation bytes (10xxxxxx).
  while (end > 0 && (buffer[end] & 0b1100_0000) === 0b1000_0000) end -= 1;
  return buffer.subarray(0, end).toString('utf8').trimEnd();
}

export function renderTemplate(
  template: string,
  vars: TemplateVariables,
  options: { maxBytes?: number } = {},
): string {
  if (typeof template !== 'string' || template.length === 0) return '';

  const rendered = template.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (match, name: string) => {
    const key = name.toLowerCase();
    if (!(TEMPLATE_VARIABLES as readonly string[]).includes(key)) return match;
    return valueFor(key, vars);
  });

  return truncateUtf8(rendered, options.maxBytes ?? MAX_RENDERED_MESSAGE_BYTES);
}

/**
 * Picks one public reply template. Returns null when there is nothing usable
 * (an empty list, or only blank entries), which callers treat as "no reply".
 */
export function pickPublicReplyTemplate(
  templates: readonly string[] | null | undefined,
  random: () => number = Math.random,
): string | null {
  const usable = (templates || []).map((template) => (typeof template === 'string' ? template.trim() : '')).filter(Boolean);
  if (usable.length === 0) return null;
  const index = Math.min(usable.length - 1, Math.floor(random() * usable.length));
  return usable[Number.isFinite(index) && index >= 0 ? index : 0];
}

/** Renders a picked public reply, or null when the automation has no templates. */
export function renderPublicReply(
  templates: readonly string[] | null | undefined,
  vars: TemplateVariables,
  random: () => number = Math.random,
): string | null {
  const picked = pickPublicReplyTemplate(templates, random);
  return picked === null ? null : renderTemplate(picked, vars);
}
