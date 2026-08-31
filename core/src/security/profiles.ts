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

/** Actions that always require an explicit human approval, whatever the profile. */
export type ApprovalKind =
  | "install_software"
  | "change_global_config"
  | "destructive_command"
  | "access_new_folder"
  | "connector_write"
  | "create_startup_service"
  | "expose_port"
  | "send_external_data"
  | "overwrite_existing_config";
