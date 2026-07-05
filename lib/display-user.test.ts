import { describe, expect, it, vi } from 'vitest';
import { displayUser, displayUsers, displayUserField, displayUserFields } from './display-user';
import * as encryption from './encryption';

vi.mock('./encryption', () => ({
  decrypt: vi.fn((val: string) => val.replace('enc:', 'dec:')),
  isEncrypted: vi.fn((val: string) => val.startsWith('enc:')),
}));

describe('lib/display-user', () => {
  describe('displayUserField', () => {
    it('returns null/undefined as is', () => {
      expect(displayUserField(null)).toBeNull();
      expect(displayUserField(undefined)).toBeNull();
    });

    it('returns unencrypted value as is', () => {
      expect(displayUserField('plain')).toBe('plain');
    });

    it('decrypts encrypted value', () => {
      expect(displayUserField('enc:secret')).toBe('dec:secret');
    });

    it('returns original value if decryption fails', () => {
      vi.mocked(encryption.decrypt).mockImplementationOnce(() => { throw new Error('fail'); });
      expect(displayUserField('enc:secret')).toBe('enc:secret');
    });
  });

  describe('displayUser', () => {
    it('decrypts PII fields', () => {
      const user = {
        id: '1',
        name: 'enc:name',
        email: 'enc:email',
        phone: 'plain',
        role: 'USER'
      };
      const result = displayUser(user);
      expect(result).toEqual({
        id: '1',
        name: 'dec:name',
        email: 'dec:email',
        phone: 'plain',
        role: 'USER'
      });
      // Ensure original is not mutated
      expect(user.name).toBe('enc:name');
    });

    it('returns null/undefined as is', () => {
      expect(displayUser(null)).toBeNull();
      expect(displayUser(undefined)).toBeUndefined();
    });
  });

  describe('displayUsers', () => {
    it('decrypts array of users', () => {
      const users = [
        { name: 'enc:n1' },
        { name: 'plain' }
      ];
      expect(displayUsers(users)).toEqual([
        { name: 'dec:n1' },
        { name: 'plain' }
      ]);
    });
  });

  describe('displayUserFields', () => {
    it('decrypts specific PII fields', () => {
      expect(displayUserFields({ name: 'enc:n1', email: 'enc:e1' })).toEqual({
        name: 'dec:n1',
        email: 'dec:e1'
      });
    });
  });
});
