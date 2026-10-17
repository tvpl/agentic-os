/**
 * The schemas the route document names (`components.schemas`): the entities that several routes answer with, so a
 * client generator produces one type for each instead of one per operation. Everything else is inlined where it is used.
 */
import { ConnectorDataSchema, ConnectorSchema } from "../connectors.js";
import { RoutineSchema, RoutineStatusSchema } from "../routines.js";
import { SettingsSchema } from "../settings.js";
import { UiPreferencesSchema } from "../preferences.js";
import { SkillSchema } from "../skills.js";
import {
  ApprovalSchema,
  BackupInfoSchema,
  DeviceRecordSchema,
  MetricsSampleSchema,
  NotificationRecordSchema,
  ProviderCapabilitiesSchema,
  RunEventSchema,
  RunRecordSchema,
  RunSummarySchema,
  RunUsageSchema,
  SessionRecordSchema,
} from "./wire.js";
import { ErrorEnvelope } from "./errors.js";
import { FactSchema } from "./memory.js";
import { DoctorReportSchema } from "./system.js";
import type { z } from "zod";

export const NAMED_SCHEMAS: { readonly [name: string]: z.ZodTypeAny } = {
  Error: ErrorEnvelope,
  Run: RunRecordSchema,
  RunSummary: RunSummarySchema,
  RunEvent: RunEventSchema,
  RunUsage: RunUsageSchema,
  Approval: ApprovalSchema,
  Notification: NotificationRecordSchema,
  Session: SessionRecordSchema,
  ProviderCapabilities: ProviderCapabilitiesSchema,
  Settings: SettingsSchema,
  UiPreferences: UiPreferencesSchema,
  Skill: SkillSchema,
  Routine: RoutineSchema,
  RoutineStatus: RoutineStatusSchema,
  Connector: ConnectorSchema,
  ConnectorData: ConnectorDataSchema,
  Device: DeviceRecordSchema,
  BackupInfo: BackupInfoSchema,
  MetricsSample: MetricsSampleSchema,
  Fact: FactSchema,
  DoctorReport: DoctorReportSchema,
};
