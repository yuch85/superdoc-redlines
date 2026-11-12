/**
 * Tests for author identity resolution (src/authorConfig.mjs)
 *
 * Precedence: explicit (CLI flags / library option) > environment
 * (SUPERDOC_AUTHOR_NAME / SUPERDOC_AUTHOR_EMAIL) > built-in default.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_AUTHOR, resolveAuthor } from '../../src/authorConfig.mjs';

const ENV_KEYS = ['SUPERDOC_AUTHOR_NAME', 'SUPERDOC_AUTHOR_EMAIL'];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

afterEach(() => {
  clearEnv();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] !== undefined) process.env[k] = savedEnv[k];
  }
});

describe('resolveAuthor', () => {
  it('falls back to the built-in default when nothing is set', () => {
    clearEnv();
    assert.deepEqual(resolveAuthor(), { name: 'Author', email: '' });
    assert.deepEqual(resolveAuthor(null), { name: 'Author', email: '' });
    assert.deepEqual(resolveAuthor({}), { name: 'Author', email: '' });
    assert.strictEqual(DEFAULT_AUTHOR.name, 'Author');
    assert.strictEqual(DEFAULT_AUTHOR.email, '');
  });

  it('uses environment variables when no explicit author is given', () => {
    clearEnv();
    process.env.SUPERDOC_AUTHOR_NAME = 'Jane Doe';
    process.env.SUPERDOC_AUTHOR_EMAIL = 'jane@firm.com';
    assert.deepEqual(resolveAuthor(), { name: 'Jane Doe', email: 'jane@firm.com' });
  });

  it('mixes explicit and environment values per field', () => {
    clearEnv();
    process.env.SUPERDOC_AUTHOR_NAME = 'Env Name';
    process.env.SUPERDOC_AUTHOR_EMAIL = 'env@firm.com';
    // Only name passed explicitly (e.g. --author-name without --author-email)
    assert.deepEqual(resolveAuthor({ name: 'CLI Name', email: undefined }),
      { name: 'CLI Name', email: 'env@firm.com' });
    // Only email passed explicitly
    assert.deepEqual(resolveAuthor({ name: undefined, email: 'cli@firm.com' }),
      { name: 'Env Name', email: 'cli@firm.com' });
  });

  it('explicit values beat the environment', () => {
    clearEnv();
    process.env.SUPERDOC_AUTHOR_NAME = 'Env Name';
    process.env.SUPERDOC_AUTHOR_EMAIL = 'env@firm.com';
    assert.deepEqual(resolveAuthor({ name: 'CLI Name', email: 'cli@firm.com' }),
      { name: 'CLI Name', email: 'cli@firm.com' });
  });

  it('an explicitly empty email beats the environment (opt-out of email)', () => {
    clearEnv();
    process.env.SUPERDOC_AUTHOR_EMAIL = 'env@firm.com';
    assert.deepEqual(resolveAuthor({ name: 'CLI Name', email: '' }),
      { name: 'CLI Name', email: '' });
  });

  it('accepts a bare string as the author name', () => {
    clearEnv();
    process.env.SUPERDOC_AUTHOR_EMAIL = 'env@firm.com';
    assert.deepEqual(resolveAuthor('Just A Name'),
      { name: 'Just A Name', email: 'env@firm.com' });
  });
});
