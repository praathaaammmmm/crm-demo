/**
 * Status rules come from the shared TASK_WORKFLOW map in @crm/contracts, so the API and web app
 * use one definition. The server still enforces everything else: permissions and visibility
 * (tasks.policy.ts), row locking, the proof-before-submit rule (tasks.service.ts), and required
 * notes (request schemas and database checks).
 */
export { canAssigneeMove, canSubmitFrom as canSubmit, isOpenStatus as isOpen } from "@crm/contracts/tasks";
