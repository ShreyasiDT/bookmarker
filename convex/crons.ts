import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily(
  "tag anything still untagged",
  { hourUTC: 9, minuteUTC: 0 },
  internal.enrich.backfill,
  {},
);

export default crons;
