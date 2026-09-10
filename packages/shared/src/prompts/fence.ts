// The prompt-injection boundary. Untrusted scraped text (page bodies, listings,
// reviews) reaches the LLM ONLY through this function.

const FENCE_OPEN_PREFIX = "<<<UNTRUSTED_CONTENT";
const FENCE_CLOSE = "<<<END_UNTRUSTED_CONTENT>>>";
const TRUNCATION_MARKER = "\n[truncated]";

/**
 * Neutralise anything that could be read as a fence delimiter. We collapse any
 * run of 2+ `<` or `>` to full-width look-alikes, so `<<<END_UNTRUSTED_CONTENT>>>`
 * embedded in scraped text can never close the real fence.
 */
function sanitize(content: string): string {
  return content
    .replace(/<{2,}/g, (run) => "＜".repeat(run.length))
    .replace(/>{2,}/g, (run) => "＞".repeat(run.length));
}

function sanitizeLabel(label: string): string {
  const cleaned = label.replace(/[^a-zA-Z0-9_.:-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || "unknown";
}

/**
 * Wrap untrusted content as a labelled, delimited block the system prompt tells
 * the model to treat as data and never as instructions.
 *
 * - truncates to `maxChars` with a visible `[truncated]` marker;
 * - strips the fence delimiter out of `content` so it cannot be broken out of.
 */
export function fenceUntrusted(
  label: string,
  content: string,
  maxChars = 20000,
): string {
  let body = content;
  let truncated = false;
  if (body.length > maxChars) {
    body = body.slice(0, maxChars);
    truncated = true;
  }

  body = sanitize(body);
  if (truncated) body += TRUNCATION_MARKER;

  const open = `${FENCE_OPEN_PREFIX} source="${sanitizeLabel(label)}">>>`;
  return `${open}\n${body}\n${FENCE_CLOSE}`;
}
