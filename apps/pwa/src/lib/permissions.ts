/** Roles that may report a new incident (City Help ticket intake). */
const INTAKE_ROLES = ['help:tickets:intake', 'intake_officer', 'help:tickets:write', '*'] as const;

/**
 * Whether to offer the "report an incident" entry.
 *
 * A field engineer has no intake permission, so the "+" would only lead to a
 * form the server refuses. The server still enforces this; hiding is for UX.
 */
export function canCreateTickets(roles: readonly string[] | undefined): boolean {
  return !!roles?.some((r) => (INTAKE_ROLES as readonly string[]).includes(r));
}
