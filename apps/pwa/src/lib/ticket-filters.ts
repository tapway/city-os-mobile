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
 * Role-based default for the ticket list: handling staff work an assigned queue,
 * everyone else sees All.
 *
 * Handling staff open on To accept only when a probe of that list found tickets
 * (`toAcceptCount` > 0). Since City Help T1.20 the server scopes state=dispatch
 * to the caller's own department for handling staff (fail-closed), so a
 * non-empty answer is theirs to accept. An empty, failed, offline or still
 * pending probe (null/undefined) falls back to Mine, so the screen never opens
 * empty or on a stale guess. Ruling M-8 had reverted this while dispatch was
 * unscoped.
 */
export function defaultTicketFilter(
  roles: readonly string[] | undefined,
  probe: { toAcceptCount?: number | null } = {},
): 'to_accept' | 'mine' | 'all' {
  if (!roles?.includes('handling_staff')) return 'all';
  return (probe.toAcceptCount ?? 0) > 0 ? 'to_accept' : 'mine';
}
