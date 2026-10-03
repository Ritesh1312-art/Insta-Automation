/**
 * The single definition of "a user's flows", shared by the Flows list
 * (GET /api/automations), the Studio counters (GET /api/stats), and the plan
 * limit checks. Flows are scoped by owner only — never by the currently
 * connected Meta account — so Studio totals always equal the Flows list.
 */
export const ACTIVE_FLOW_STATUS = 'ACTIVE';

export function userFlowsWhere(userId: string) {
  return { userId };
}

/** Flows whose stored status is exactly `ACTIVE`. */
export function activeUserFlowsWhere(userId: string) {
  return { userId, status: ACTIVE_FLOW_STATUS };
}
