/*
 * Where a page may send someone after an action.
 *
 * A `returnTo` taken at face value is an open redirect. It matters most
 * on pages a person arrives at from a link in an email — "your terms
 * have changed, click here" is the same shape as the phishing message
 * that would abuse it, and the destination is what the abuse is for.
 *
 * Allows only a path on this site, under the locale already being
 * viewed. Anything else falls back rather than throwing: a bad
 * `returnTo` is a hostile input, not a user error, and there is nothing
 * to tell them.
 */
export function safeReturnTo(
  returnTo: string | undefined,
  locale: string,
  fallback = `/${locale}/lots`,
): string {
  if (!returnTo) return fallback;

  /*
   * Both of these are absolute to a browser despite the leading slash:
   * "//evil.example" is protocol-relative, and a backslash is treated as
   * a slash by every major engine.
   */
  if (returnTo.startsWith("//") || returnTo.includes("\\")) return fallback;

  // Control characters, including the newline that would split a header.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(returnTo)) return fallback;

  if (!returnTo.startsWith(`/${locale}/`)) return fallback;

  return returnTo;
}
