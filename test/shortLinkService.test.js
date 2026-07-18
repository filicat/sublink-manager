import { describe, it, expect } from 'vitest';
import { ShortLinkService, generateEditToken } from '../src/services/shortLinkService.js';
import { MemoryKVAdapter } from '../src/adapters/kv/memoryKv.js';

function createService() {
    const kv = new MemoryKVAdapter();
    return new ShortLinkService(kv);
}

describe('generateEditToken', () => {
    it('returns a 32-character hex string', () => {
        const token = generateEditToken();
        expect(token).toHaveLength(32);
        expect(/^[0-9a-f]{32}$/.test(token)).toBe(true);
    });

    it('returns different tokens on subsequent calls', () => {
        const t1 = generateEditToken();
        const t2 = generateEditToken();
        expect(t1).not.toBe(t2);
    });
});

describe('ShortLinkService', () => {
    it('createShortLink stores query string and returns shortCode + editToken', async () => {
        const svc = createService();
        const result = await svc.createShortLink('?config=vmess://test', null);

        expect(result).toHaveProperty('shortCode');
        expect(result).toHaveProperty('editToken');
        expect(result.shortCode).toHaveLength(7);
        expect(result.editToken).toHaveLength(32);
    });

    it('createShortLink with providedCode reuses existing edit token', async () => {
        const svc = createService();
        const first = await svc.createShortLink('?config=first', 'mycode');
        const second = await svc.createShortLink('?config=second', 'mycode');

        expect(second.shortCode).toBe('mycode');
        expect(second.editToken).toBe(first.editToken);
    });

    it('resolveShortCode returns the stored query string', async () => {
        const svc = createService();
        const result = await svc.createShortLink('?config=vmess://test', null);
        const resolved = await svc.resolveShortCode(result.shortCode);

        expect(resolved).toBe('?config=vmess://test');
    });

    it('updateShortLink updates the query string with valid token', async () => {
        const svc = createService();
        const result = await svc.createShortLink('?config=original', null);
        await svc.updateShortLink(result.shortCode, result.editToken, '?config=updated');

        const resolved = await svc.resolveShortCode(result.shortCode);
        expect(resolved).toBe('?config=updated');
    });

    it('updateShortLink throws ForbiddenError with wrong token', async () => {
        const svc = createService();
        const result = await svc.createShortLink('?config=original', null);

        await expect(
            svc.updateShortLink(result.shortCode, 'wrong-token', '?config=hacked')
        ).rejects.toThrow('Invalid edit token');
    });

    it('updateShortLink throws ForbiddenError when no edit token exists (pre-feature links)', async () => {
        const kv = new MemoryKVAdapter();
        // Simulate a pre-feature short link without edit token
        await kv.put('oldlink', '?config=old');

        const svc = new ShortLinkService(kv);
        await expect(
            svc.updateShortLink('oldlink', 'any-token', '?config=hacked')
        ).rejects.toThrow('created before edit support');
    });

    it('deleteShortLink removes both keys', async () => {
        const svc = createService();
        const result = await svc.createShortLink('?config=test', null);
        await svc.deleteShortLink(result.shortCode, result.editToken);

        const resolved = await svc.resolveShortCode(result.shortCode);
        expect(resolved).toBeNull();
    });

    it('deleteShortLink throws ForbiddenError with wrong token', async () => {
        const svc = createService();
        const result = await svc.createShortLink('?config=test', null);

        await expect(
            svc.deleteShortLink(result.shortCode, 'wrong-token')
        ).rejects.toThrow('Invalid edit token');
    });
});
