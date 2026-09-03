/** Run status helpers with no API/DOM imports, so pure modules can use them. */
export const ACTIVE_RUN_STATUSES: readonly string[] = ["queued", "running", "waiting_approval"];

export const isRunActive = (status: string | undefined): boolean =>
  status !== undefined && ACTIVE_RUN_STATUSES.includes(status);

/** Statuses that ended badly (used for the list filter and the detail tone). */
export const isRunFailed = (status: string | undefined): boolean =>
  status === "failed" || status === "timed_out" || status === "interrupted";
