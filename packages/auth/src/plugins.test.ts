import { admin } from 'better-auth/plugins/admin';
import { haveIBeenPwned } from 'better-auth/plugins/haveibeenpwned';
import { organization } from 'better-auth/plugins/organization';
import { describe, expect, it } from 'vitest';

describe('Better Auth plugins', () => {
  it('loads organization, admin, and haveIBeenPwned', () => {
    expect([organization().id, admin().id, haveIBeenPwned({ enabled: false }).id]).toEqual([
      'organization',
      'admin',
      'have-i-been-pwned',
    ]);
  });
});
