import { describe, expect, it } from 'vitest';
import { decryptMessage, encryptMessage } from './e2ee';

describe('shared-secret encryption', () => {
  it('round-trips content and rejects the wrong secret', async () => {
    const salt = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
    const encrypted = await encryptMessage('private message', 'correct horse battery staple', salt);
    await expect(decryptMessage(encrypted.encrypted_content, encrypted.encryption_iv, 'correct horse battery staple', salt)).resolves.toBe('private message');
    await expect(decryptMessage(encrypted.encrypted_content, encrypted.encryption_iv, 'wrong secret value', salt)).rejects.toBeDefined();
  });
});
