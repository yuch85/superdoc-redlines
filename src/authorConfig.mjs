/**
 * Shared redline author identity and its resolution order.
 *
 * Precedence (highest wins):
 *   1. Explicit author for the run: CLI --author-name / --author-email,
 *      or the `author` / `user` option passed to a library function.
 *   2. Environment variables SUPERDOC_AUTHOR_NAME / SUPERDOC_AUTHOR_EMAIL.
 *   3. DEFAULT_AUTHOR below.
 */

export const DEFAULT_AUTHOR = Object.freeze({ name: 'Author', email: '' });

/**
 * Resolve the effective author for a run.
 *
 * An explicitly passed value always wins, including an intentionally empty
 * email. Unset values fall back to the environment, then to DEFAULT_AUTHOR.
 *
 * @param {{ name?: string, email?: string } | string | null | undefined} [explicit]
 * @returns {{ name: string, email: string }}
 */
export function resolveAuthor(explicit) {
  const envName = process.env.SUPERDOC_AUTHOR_NAME || undefined;
  const envEmail = process.env.SUPERDOC_AUTHOR_EMAIL ?? undefined;
  if (typeof explicit === 'string') {
    return {
      name: explicit || envName || DEFAULT_AUTHOR.name,
      email: envEmail ?? DEFAULT_AUTHOR.email
    };
  }
  return {
    name: explicit?.name || envName || DEFAULT_AUTHOR.name,
    email: explicit?.email ?? envEmail ?? DEFAULT_AUTHOR.email
  };
}
