import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily(
  "tag anything still untagged",
  { hourUTC: 9, minuteUTC: 0 },
  internal.enrich.backfill,
  {},
);
crons.daily(
  "embed anything without a vector",
  { hourUTC: 9, minuteUTC: 30 },
  internal.embed.backfill,
  {},
);

export default crons;
