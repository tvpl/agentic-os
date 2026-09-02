import type { SecurityProfile } from "../config/schema.js";

export interface ProfileCapabilities {
  /** May the agent write files in its working directory? */
  writeFiles: boolean;
  /** Are writes applied without a human diff review first? */
  autoApplyWrites: boolean;
  /** May routines run unattended with write access? */
  unattendedWrites: boolean;
  labelKey: string;
}

export const PROFILES: Record<SecurityProfile, ProfileCapabilities> = {
  read_only: {
    writeFiles: false,
    autoApplyWrites: false,
    unattendedWrites: false,
    labelKey: "profile.read_only",
  },
  review_before_write: {
    writeFiles: true,
    autoApplyWrites: false,
    unattendedWrites: false,
    labelKey: "profile.review_before_write",
  },
  controlled_write: {
    writeFiles: true,
    autoApplyWrites: true,
    unattendedWrites: false,
    labelKey: "profile.controlled_write",
  },
  approved_automation: {
    writeFiles: true,
    autoApplyWrites: true,
    unattendedWrites: true,
    labelKey: "profile.approved_automation",
  },
};

export type WriteOrigin = "manual" | "skill" | "routine" | "api";
export type WriteDecision = "allow" | "approval" | "refuse";

/**
 * The run-level write policy, derived from the profile capabilities:
 * - `read_only`            → write runs are refused;
 * - `review_before_write`  → interactive write runs wait for a human approval;
 * - `controlled_write`     → interactive write runs apply immediately, routines cannot write;
 * - `approved_automation`  → routines may also write, unattended.
 */
export function writeDecision(profile: SecurityProfile, origin: WriteOrigin): WriteDecision {
  const caps = PROFILES[profile];
  if (!caps.writeFiles) return "refuse";
  if (origin === "routine") return caps.unattendedWrites ? "allow" : "refuse";
  return caps.autoApplyWrites ? "allow" : "approval";
}

/** Actions that always require an explicit human approval, whatever the profile. */
export type ApprovalKind =
  | "write_run"
  | "install_software"
  | "change_global_config"
  | "destructive_command"
  | "access_new_folder"
  | "connector_write"
  | "create_startup_service"
  | "expose_port"
  | "send_external_data"
  | "overwrite_existing_config";
