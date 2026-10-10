// Existing consumers outside briefing retain this entrypoint. Persistence is
// implemented in repositories/; use cases are plain functions in services/.
export type { ProfileVersion, ProposalRecord } from "./contracts";
export { BriefingRepository } from "./services/briefing.service";
