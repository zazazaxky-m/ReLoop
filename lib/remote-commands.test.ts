import { describe, expect, it } from 'vitest';
import * as rc from './remote-commands';

describe('lib/remote-commands', () => {
  it('exports REMOTE_COMMAND_EXPIRY_SECONDS', () => {
    expect(rc.REMOTE_COMMAND_EXPIRY_SECONDS).toBe(60);
  });

  it('exports DANGEROUS_REMOTE_COMMANDS set', () => {
    expect(rc.DANGEROUS_REMOTE_COMMANDS.has('STOP_ALL')).toBe(true);
    expect(rc.DANGEROUS_REMOTE_COMMANDS.has('OPEN_GATE')).toBe(true);
    expect(rc.DANGEROUS_REMOTE_COMMANDS.has('REFRESH_STATE')).toBe(false);
  });

  it('exports remoteCommandLabels', () => {
    expect(rc.remoteCommandLabels.REFRESH_STATE).toBe('Perbarui status');
    expect(rc.remoteCommandLabels.STOP_ALL).toBe('Stop semua aktuator');
  });
});
