import { describe, expect, it, vi } from 'vitest';
import { LEGACY_CUTOVER_ENV, REWARD_POLICY_MIGRATION, resolveLegacyCutover, resolveMigrationCutover } from '@/lib/reward-legacy-cutover';

describe('resolveMigrationCutover combine modes (B01a fix round 2, C3)', () => {
  const finishedAt = new Date('2026-10-14T15:00:00.000Z');
  const withMigration = () => {
    const db = { $queryRaw: vi.fn() };
    db.$queryRaw.mockResolvedValueOnce([{ present: true }]).mockResolvedValueOnce([{ finishedAt }]);
    return db;
  };
  const options = { migration: 'm', envName: 'X' };

  it('env-wins (the default, M04): an explicit setting replaces the migration time, even a later one', async () => {
    const db = withMigration();
    expect(await resolveMigrationCutover(db as never, { ...options, env: { X: '2026-10-20T00:00:00Z' } }))
      .toEqual({ at: new Date('2026-10-20T00:00:00.000Z'), source: 'env' });
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(await resolveMigrationCutover(withMigration() as never, { ...options, env: { X: '2026-10-20T00:00:00Z' }, combine: 'env-wins' }))
      .toEqual({ at: new Date('2026-10-20T00:00:00.000Z'), source: 'env' });
  });

  it('earliest (funding): the earlier of the setting and the migration; an unparsable setting fails closed', async () => {
    expect(await resolveMigrationCutover(withMigration() as never, { ...options, env: { X: '2026-10-20T00:00:00Z' }, combine: 'earliest' }))
      .toEqual({ at: finishedAt, source: 'migration' });
    expect(await resolveMigrationCutover(withMigration() as never, { ...options, env: { X: '2026-10-10T00:00:00Z' }, combine: 'earliest' }))
      .toEqual({ at: new Date('2026-10-10T00:00:00.000Z'), source: 'env' });
    expect(await resolveMigrationCutover(withMigration() as never, { ...options, env: { X: finishedAt.toISOString() }, combine: 'earliest' }))
      .toEqual({ at: finishedAt, source: 'env' });
    expect(await resolveMigrationCutover(withMigration() as never, { ...options, env: { X: 'bukan-tanggal' }, combine: 'earliest' }))
      .toEqual({ at: null, source: 'env-invalid' });
    expect(await resolveMigrationCutover(withMigration() as never, { ...options, env: {}, combine: 'earliest' }))
      .toEqual({ at: finishedAt, source: 'migration' });
  });
});

/** `$queryRaw` is a tagged template: call[0] is the strings array, call[1..] the values. */
const reader = () => ({ $queryRaw: vi.fn() }) as unknown as { $queryRaw: ReturnType<typeof vi.fn> };
const sqlOf = (call: unknown[]) => (call[0] as readonly string[]).join('?');

describe('resolveLegacyCutover (M04 fix round 5, L1)', () => {
  it('uses the applied time of the reward-policy migration when nothing is configured', async () => {
    const db = reader();
    const finishedAt = new Date('2026-10-14T01:30:00.000Z');
    db.$queryRaw.mockResolvedValueOnce([{ present: true }]).mockResolvedValueOnce([{ finishedAt }]);

    expect(await resolveLegacyCutover(db as never, {})).toEqual({ at: finishedAt, source: 'migration' });
    expect(sqlOf(db.$queryRaw.mock.calls[0])).toContain('to_regclass');
    const applied = db.$queryRaw.mock.calls[1];
    expect(sqlOf(applied)).toContain('"_prisma_migrations"');
    expect(sqlOf(applied)).toContain('rolled_back_at IS NULL');
    expect(sqlOf(applied)).toContain('finished_at IS NOT NULL');
    expect(applied[1]).toBe(REWARD_POLICY_MIGRATION);
  });

  it('fails closed when the migration is not applied or the migrations table is missing', async () => {
    const notApplied = reader();
    notApplied.$queryRaw.mockResolvedValueOnce([{ present: true }]).mockResolvedValueOnce([]);
    expect(await resolveLegacyCutover(notApplied as never, {})).toEqual({ at: null, source: 'migration-missing' });

    const noTable = reader();
    noTable.$queryRaw.mockResolvedValueOnce([{ present: false }]);
    expect(await resolveLegacyCutover(noTable as never, {})).toEqual({ at: null, source: 'migration-missing' });
    // Never queries a table that does not exist (inside a transaction that would abort it).
    expect(noTable.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('an explicit setting wins over the migration; an unparsable one fails closed instead of falling back', async () => {
    const db = reader();
    db.$queryRaw.mockResolvedValue([{ present: true }]);
    expect(await resolveLegacyCutover(db as never, { [LEGACY_CUTOVER_ENV]: '2026-10-15T00:00:00Z' }))
      .toEqual({ at: new Date('2026-10-15T00:00:00.000Z'), source: 'env' });
    expect(db.$queryRaw).not.toHaveBeenCalled();

    expect(await resolveLegacyCutover(db as never, { [LEGACY_CUTOVER_ENV]: 'bukan-tanggal' }))
      .toEqual({ at: null, source: 'env-invalid' });
    expect(db.$queryRaw).not.toHaveBeenCalled();

    // Blank is "unset": the migration decides.
    db.$queryRaw.mockResolvedValueOnce([{ present: true }]).mockResolvedValueOnce([{ finishedAt: new Date('2026-10-14T01:30:00.000Z') }]);
    expect((await resolveLegacyCutover(db as never, { [LEGACY_CUTOVER_ENV]: '   ' })).source).toBe('migration');
  });
});
