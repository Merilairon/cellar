import { describe, expect, it } from 'vitest';
import { navItems } from './nav';

describe('navItems', () => {
  it('shows Admin only to admins', () => {
    expect(navItems('member').map((i) => i.href)).toEqual(['/recipes', '/import']);
    expect(navItems('admin').map((i) => i.href)).toEqual(['/recipes', '/import', '/admin/users']);
  });
});
