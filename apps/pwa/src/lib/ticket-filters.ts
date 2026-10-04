import type { MessageKey } from '../i18n';

export interface TicketFilter {
  id: string;
  labelKey: MessageKey;
  statuses?: string[];
  assignee?: 'me';
  /** workflow_state sent as `state=`. */
  state?: string;
}

/** Test ids are `tickets-filter-{id}`: mine, to_accept, all, ... */
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
 * Role-based default for the ticket list.
 *
 * Handling staff (the field engineer) start on To accept when something is
 * waiting for them, otherwise on Mine; everyone else on All.
 */
export function defaultTicketFilter(
  roles: readonly string[] | undefined,
  toAcceptCount?: number | null,
): 'to_accept' | 'mine' | 'all' {
  if (!roles?.includes('handling_staff')) return 'all';
  return toAcceptCount && toAcceptCount > 0 ? 'to_accept' : 'mine';
}
