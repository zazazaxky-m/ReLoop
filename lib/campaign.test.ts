import { describe, expect, it } from 'vitest';
import { normalizeEmailDomains, isCampaignEligible } from './campaign';

describe('lib/campaign', () => {
  describe('normalizeEmailDomains', () => {
    it('normalizes domains and removes duplicates', () => {
      const input = ['example.com', ' @example.com ', 'TEST.ORG', 'invalid', '@test.org'];
      const result = normalizeEmailDomains(input);
      expect(result).toEqual(['@example.com', '@test.org']);
    });

    it('returns empty array if no valid domains', () => {
      expect(normalizeEmailDomains(['invalid', 'test', '@'])).toEqual([]);
    });
  });

  describe('isCampaignEligible', () => {
    const baseCampaign = {
      visibility: 'PRIVATE',
      status: 'ACTIVE',
      startAt: new Date(Date.now() - 10000),
      endAt: new Date(Date.now() + 10000),
      allowedEmailDomainsJson: ['@example.com'],
    } as any;

    it('returns ineligible if status is not ACTIVE', () => {
      const res = isCampaignEligible({ ...baseCampaign, status: 'INACTIVE' }, 'user@example.com');
      expect(res.eligible).toBe(false);
      expect(res.reason).toBe('CAMPAIGN_INACTIVE');
    });

    it('returns ineligible if not started yet', () => {
      const res = isCampaignEligible({ ...baseCampaign, startAt: new Date(Date.now() + 10000) }, 'user@example.com');
      expect(res.eligible).toBe(false);
      expect(res.reason).toBe('CAMPAIGN_NOT_STARTED');
    });

    it('returns ineligible if ended', () => {
      const res = isCampaignEligible({ ...baseCampaign, endAt: new Date(Date.now() - 10000) }, 'user@example.com');
      expect(res.eligible).toBe(false);
      expect(res.reason).toBe('CAMPAIGN_ENDED');
    });

    it('returns eligible if PUBLIC', () => {
      const res = isCampaignEligible({ ...baseCampaign, visibility: 'PUBLIC' }, 'user@other.com');
      expect(res.eligible).toBe(true);
    });

    it('returns ineligible if PRIVATE and domains list is empty', () => {
      const res = isCampaignEligible({ ...baseCampaign, allowedEmailDomainsJson: [] }, 'user@example.com');
      expect(res.eligible).toBe(false);
      expect(res.reason).toBe('PRIVATE_NO_DOMAINS');
    });

    it('returns ineligible if email does not match domains', () => {
      const res = isCampaignEligible(baseCampaign, 'user@other.com');
      expect(res.eligible).toBe(false);
      expect(res.reason).toBe('EMAIL_DOMAIN_MISMATCH');
    });

    it('returns eligible if email matches domains', () => {
      const res = isCampaignEligible(baseCampaign, 'USER@example.com');
      expect(res.eligible).toBe(true);
    });

    it('handles domains without @ symbol', () => {
      const res = isCampaignEligible({ ...baseCampaign, allowedEmailDomainsJson: ['example.com'] }, 'user@example.com');
      expect(res.eligible).toBe(true);
    });
  });
});
