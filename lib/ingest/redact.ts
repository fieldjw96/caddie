// What the ingest workflow does to every line before it reaches a log. GitHub masks a
// repository secret in the job log, but only the exact string, and not in the step summary: a
// driver error that printed the connection string with its password percent-decoded, or a
// summary line built from the output, would land unmasked on a public repository's run page.
// So each line is redacted here, by pattern and by the literal value, before it is shown.
// Same patterns as rolodeck-ai's .github/workflows/ingest-run.yml.

const MASK = "***";

/** `scheme://user:pass@` in any URI, whatever the scheme. */
const URI_CREDENTIALS = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^:/@\s]+:[^@\s]+@/g;

/** `password=...` in a libpq keyword string or a query string, up to a space or `&`. */
const PASSWORD_PAIR = /(password=)[^\s&]+/gi;

/**
 * The strings that must never appear in a log, from the connection string itself: the whole
 * value, and its password both as written and percent-decoded. Empty when there is nothing to
 * hide, and a value that is not a URL contributes only itself.
 */
export function secretsFrom(connectionString: string | undefined): string[] {
  if (!connectionString) return [];
  const secrets = new Set([connectionString]);
  try {
    const { password } = new URL(connectionString);
    if (password) {
      secrets.add(password);
      secrets.add(decodeURIComponent(password));
    }
  } catch {
    // Not a URL. The whole value is still hidden, which is what matters.
  }
  // Longest first, so the whole URL is masked before its password inside it is.
  return [...secrets].filter((s) => s.length > 0).sort((a, b) => b.length - a.length);
}

/** `text` with every credential it contains replaced by `***`. */
export function redact(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const secret of secrets) out = out.split(secret).join(MASK);
  return out
    .replace(URI_CREDENTIALS, `$1${MASK}:${MASK}@`)
    .replace(PASSWORD_PAIR, `$1${MASK}`);
}

/**
 * Every way `text` still shows a credential, described without repeating it. Empty means the
 * text is safe to show. Used as the last step of the workflow, over everything it logged.
 */
export function findLeaks(text: string, secrets: readonly string[] = []): string[] {
  const leaks: string[] = [];
  if (secrets.some((s) => text.includes(s))) {
    leaks.push("the connection string, or its password, appears verbatim");
  }
  for (const match of text.matchAll(URI_CREDENTIALS)) {
    if (!match[0].endsWith(`${MASK}:${MASK}@`)) {
      leaks.push(`a URI with credentials, scheme ${match[1]}`);
    }
  }
  for (const match of text.matchAll(PASSWORD_PAIR)) {
    if (!match[0].endsWith(`=${MASK}`)) leaks.push("a password= pair");
  }
  return leaks;
}
