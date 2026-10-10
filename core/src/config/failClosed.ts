import type { FailClosedField } from "./tolerant.js";

/**
 * What a settings value this version cannot read becomes when it is one that gates what may run, who may decide,
 * what may be read or how much may be spent. The default of the schema is what a field that was never written
 * reads as; for these fields it is NOT safe to read an unreadable value as the default, because the default can
 * be more permissive than anything the owner may have meant (a folder that was switched off reads as on, a list
 * of people allowed to approve that reads as empty means anybody in the chat, a spend alert at 0 is no alert).
 * So each of them has a closed value: the most restrictive valid value of the field.
 *
 * `tests/data.settings.test.ts` checks every leaf of the schema against this table: a new field is either
 * listed here or named as one that opens nothing, so a permissive default cannot slip in unclassified.
 */
export const SETTINGS_FAIL_CLOSED: readonly FailClosedField[] = [
  // The most restrictive profile: nothing is written.
  { path: "securityProfile", closed: "read_only" },
  // A folder the owner granted stays listed (its path is valid) but is switched off.
  { path: "indexedFolders.*.enabled", closed: false },
  // A provider pinned to a binary whose path is unreadable is not run through PATH instead: it is switched off.
  { path: "providers.*.binaryPath", closed: null, also: [{ sibling: "enabled", value: false }] },
  // An empty list means anybody in the configured chat may approve: an unreadable list switches the channel off.
  {
    path: "channels.telegram.allowedUserIds",
    closed: [],
    also: [
      { sibling: "enabled", value: false },
      { sibling: "inbound", value: false },
    ],
  },
  // The skills that get `memory/` and a credential of their own: none.
  { path: "memorySkills", closed: [] },
  // 0 means no spend alert; the smallest positive budget alerts at once instead.
  { path: "limits.dailyBudgetUsd", closed: 0.01 },
  // Approvals and device tokens live as briefly as the schema allows.
  { path: "limits.approvalTtlDays", closed: 1 },
  { path: "remote.deviceTtlDays", closed: 1 },
  // 0 means no triage runs at all.
  { path: "sentinels.triage.dailyBudgetUsd", closed: 0 },
];
