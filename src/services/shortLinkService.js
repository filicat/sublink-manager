import { generateWebPath } from '../utils.js';
import { ForbiddenError, MissingDependencyError } from './errors.js';

/**
 * Generate a 128-bit cryptographically random edit token.
 * Falls back to generateWebPath if crypto.getRandomValues is unavailable (e.g. old runtimes).
 */
export function generateEditToken() {
    try {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch {
        // Fallback: 32-char alphanumeric string (~190 bits of entropy from Math.random)
        return generateWebPath(32);
    }
}

const EDIT_TOKEN_PREFIX = 'et:';

export class ShortLinkService {
    constructor(kv, options = {}) {
        this.kv = kv;
        this.options = options;
    }

    ensureKv() {
        if (!this.kv) {
            throw new MissingDependencyError('Short link service requires a KV store');
        }
        return this.kv;
    }

    async createShortLink(queryString, providedCode) {
        const kv = this.ensureKv();
        const shortCode = providedCode || generateWebPath();
        const ttl = this.options.shortLinkTtlSeconds;
        const putOptions = ttl ? { expirationTtl: ttl } : undefined;

        // Store the query string
        await kv.put(shortCode, queryString, putOptions);

        // Generate and store edit token, or reuse existing one
        let editToken = await kv.get(EDIT_TOKEN_PREFIX + shortCode);
        if (!editToken) {
            editToken = generateEditToken();
            await kv.put(EDIT_TOKEN_PREFIX + shortCode, editToken, putOptions);
        }

        return { shortCode, editToken };
    }

    async resolveShortCode(code) {
        const kv = this.ensureKv();
        return kv.get(code);
    }

    /**
     * Verify an edit token without modifying any data.
     * Returns true if the token is valid, throws ForbiddenError otherwise.
     */
    async verifyEditToken(shortCode, editToken) {
        const kv = this.ensureKv();

        const existing = await kv.get(shortCode);
        if (existing === null) {
            throw new ForbiddenError('Short URL not found');
        }

        const storedToken = await kv.get(EDIT_TOKEN_PREFIX + shortCode);
        if (!storedToken || storedToken !== editToken) {
            throw new ForbiddenError('Invalid edit token');
        }

        return true;
    }

    async updateShortLink(shortCode, editToken, newQueryString) {
        const kv = this.ensureKv();

        // Verify the short link exists
        const existing = await kv.get(shortCode);
        if (existing === null) {
            throw new MissingDependencyError('Short URL not found');
        }

        // Verify edit token
        const storedToken = await kv.get(EDIT_TOKEN_PREFIX + shortCode);
        if (!storedToken) {
            throw new ForbiddenError('This short link was created before edit support. Please create a new one.');
        }
        if (storedToken !== editToken) {
            throw new ForbiddenError('Invalid edit token');
        }

        const ttl = this.options.shortLinkTtlSeconds;
        const putOptions = ttl ? { expirationTtl: ttl } : undefined;
        await kv.put(shortCode, newQueryString, putOptions);

        // Refresh edit token TTL to match
        if (putOptions) {
            await kv.put(EDIT_TOKEN_PREFIX + shortCode, editToken, putOptions);
        }

        return { shortCode };
    }

    async deleteShortLink(shortCode, editToken) {
        const kv = this.ensureKv();

        // Verify the short link exists
        const existing = await kv.get(shortCode);
        if (existing === null) {
            throw new MissingDependencyError('Short URL not found');
        }

        // Verify edit token
        const storedToken = await kv.get(EDIT_TOKEN_PREFIX + shortCode);
        if (!storedToken) {
            throw new ForbiddenError('This short link was created before edit support. Please create a new one.');
        }
        if (storedToken !== editToken) {
            throw new ForbiddenError('Invalid edit token');
        }

        await kv.delete(shortCode);
        await kv.delete(EDIT_TOKEN_PREFIX + shortCode);

        return { deleted: true };
    }
}
