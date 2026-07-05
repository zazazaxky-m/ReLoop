import { describe, expect, it } from 'vitest';
import * as api from './api';
import { HttpError } from './rbac';
import { ZodError, ZodIssue } from 'zod';

describe('lib/api', () => {
  describe('jsonOk', () => {
    it('returns a successful JSON response', async () => {
      const data = { message: 'success' };
      const res = api.jsonOk(data);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual(data);
    });

    it('returns a successful JSON response with custom status', async () => {
      const data = { message: 'created' };
      const res = api.jsonOk(data, 201);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json).toEqual(data);
    });
  });

  describe('jsonError', () => {
    it('returns an error JSON response', async () => {
      const res = api.jsonError(400, 'Bad Request');
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json).toEqual({ error: 'Bad Request' });
    });

    it('returns an error JSON response with extra data', async () => {
      const res = api.jsonError(422, 'Validation Error', { field: 'email' });
      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json).toEqual({ error: 'Validation Error', field: 'email' });
    });
  });

  describe('handleApiError', () => {
    it('handles HttpError correctly', async () => {
      const error = new HttpError(403, 'Forbidden access');
      const res = api.handleApiError(error);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json).toEqual({ error: 'Forbidden access' });
    });

    it('handles ZodError correctly', async () => {
      const issues: ZodIssue[] = [
        { path: ['user', 'email'], message: 'Invalid email', code: 'custom' }
      ];
      const error = new ZodError(issues);
      const res = api.handleApiError(error);
      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json).toEqual({
        error: 'Validasi gagal',
        issues: [
          { path: 'user.email', message: 'Invalid email' }
        ]
      });
    });

    it('handles generic unknown errors correctly (500)', async () => {
      const error = new Error('Database connection failed');
      // Mute console.error for this test to keep output clean
      const originalConsoleError = console.error;
      console.error = () => {};
      
      const res = api.handleApiError(error);
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json).toEqual({ error: 'Terjadi kesalahan pada server' });
      
      console.error = originalConsoleError;
    });
  });
});
