/** Role-based default for the ticket list. */
/** Mine for handling staff (they work an assigned queue); All for everyone else. */
export function defaultTicketFilter(roles: readonly string[] | undefined): 'mine' | 'all' {
  return roles?.includes('handling_staff') ? 'mine' : 'all';
}
