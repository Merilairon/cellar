export type NavItem = { href: string; labelKey: string };

/** Header navigation: Admin is only offered to admins (the pages enforce this server-side). */
export function navItems(role: 'admin' | 'member'): NavItem[] {
  const items: NavItem[] = [
    { href: '/recipes', labelKey: 'nav.recipes' },
    { href: '/import', labelKey: 'nav.import' },
  ];
  if (role === 'admin') items.push({ href: '/admin/users', labelKey: 'nav.admin' });
  return items;
}
