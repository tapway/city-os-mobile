import type { MessageKey } from '../i18n';

export interface TicketFilter {
  id: string;
  labelKey: MessageKey;
  statuses?: string[];
  assignee?: 'me';
  /** workflow_state sent as `state=`. */
  state?: string;
}

/** M7 test id: `tickets-filter-{id with - for _}` (mine, to-accept, in-progress, ...). */
export function filterTestId(f: TicketFilter): string {
  return `tickets-filter-${f.id.replace(/_/g, '-')}`;
}

export const TICKET_FILTERS: TicketFilter[] = [
  { id: 'to_accept', labelKey: 'tickets.filter.toAccept', state: 'dispatch' },
  { id: 'mine', labelKey: 'tickets.filter.mine', assignee: 'me' },
  { id: 'all', labelKey: 'tickets.filter.all' },
  { id: 'open', labelKey: 'tickets.filter.open', statuses: ['OPEN'] },
  { id: 'assigned', labelKey: 'tickets.filter.assigned', statuses: ['ASSIGNED', 'VERIFIED'] },
  { id: 'in_progress', labelKey: 'tickets.filter.inProgress', statuses: ['IN_PROGRESS'] },
  { id: 'resolved', labelKey: 'tickets.filter.resolved', statuses: ['RESOLVED'] },
  { id: 'closed', labelKey: 'tickets.filter.closed', statuses: ['CLOSED'] },
];

/**
 * Role-based default for the ticket list: Mine for handling staff (they work an
 * assigned queue), All for everyone else. To accept is a chip, not the default:
 * the server's state=dispatch is not yet scoped to the caller's department.
 */
export function defaultTicketFilter(roles: readonly string[] | undefined): 'mine' | 'all' {
  return roles?.includes('handling_staff') ? 'mine' : 'all';
}
