import {
  ApprovalStore,
  ConnectorRegistry,
  MemoryIndexer,
  RoutineScheduler,
  RoutineStore,
  RunManager,
  SettingsStore,
  SkillCatalog,
  SyncCompiler,
  ensureDirs,
  openDb,
  resolvePaths,
  type AgentAdapter,
  type Db,
  type HealthStatus,
  type MordomoPaths,
  type ProviderId,
  type Settings,
} from "@mordomo/core";
import { ClaudeAdapter } from "@mordomo/adapter-claude";
import { CursorAdapter } from "@mordomo/adapter-cursor";
import { CodexAdapter } from "@mordomo/adapter-codex";

export interface ProviderSnapshot {
  id: ProviderId;
  enabled: boolean;
  isDefault: boolean;
  health: HealthStatus;
  defaultModel: string | null;
  defaultEffort: string;
}

export class AppContext {
  readonly paths: MordomoPaths;
  readonly settingsStore: SettingsStore;
  readonly db: Db;
  readonly adapters: Record<ProviderId, AgentAdapter>;
  readonly runs: RunManager;
  readonly skills: SkillCatalog;
  readonly indexer: MemoryIndexer;
  readonly routines: RoutineStore;
  readonly scheduler: RoutineScheduler;
  readonly connectors: ConnectorRegistry;
  readonly sync: SyncCompiler;
  readonly approvals: ApprovalStore;
  readonly startedAt = Date.now();

  private healthCache = new Map<ProviderId, { at: number; health: HealthStatus }>();

  constructor(homeOverride?: string) {
    this.paths = resolvePaths(homeOverride);
    ensureDirs(this.paths);
    this.settingsStore = new SettingsStore(this.paths);
    this.db = openDb(this.paths).db;
    const settings = this.settingsStore.load();
    this.adapters = {
      claude: new ClaudeAdapter({ binaryPath: settings.providers.claude.binaryPath }),
      cursor: new CursorAdapter({ binaryPath: settings.providers.cursor.binaryPath }),
      codex: new CodexAdapter({ binaryPath: settings.providers.codex.binaryPath }),
    };
    this.skills = new SkillCatalog(this.paths);
    this.runs = new RunManager(this.db, this.paths, () => this.settings(), (id) => this.adapters[id]);
    this.indexer = new MemoryIndexer(this.db, () => this.settings());
    this.routines = new RoutineStore(this.paths);
    this.scheduler = new RoutineScheduler(this.db, this.paths, this.routines, this.runs, this.skills, () => this.settings());
    this.connectors = new ConnectorRegistry(this.paths);
    this.sync = new SyncCompiler(this.paths, () => this.settings(), () => this.skills.list());
    this.approvals = new ApprovalStore(this.db);
  }

  settings(): Settings {
    return this.settingsStore.load();
  }

  token(): string {
    return this.settingsStore.getOrCreateToken();
  }

  async providerSnapshot(force = false): Promise<ProviderSnapshot[]> {
    const settings = this.settings();
    const out: ProviderSnapshot[] = [];
    for (const id of ["claude", "cursor", "codex"] as ProviderId[]) {
      const cached = this.healthCache.get(id);
      let health: HealthStatus;
      if (!force && cached && Date.now() - cached.at < 60_000) {
        health = cached.health;
      } else {
        health = await this.adapters[id].healthCheck();
        this.healthCache.set(id, { at: Date.now(), health });
      }
      out.push({
        id,
        enabled: settings.providers[id].enabled,
        isDefault: settings.defaultProvider === id,
        health,
        defaultModel: settings.providers[id].defaultModel,
        defaultEffort: settings.providers[id].defaultEffort,
      });
    }
    return out;
  }

  invalidateProviderCache(): void {
    this.healthCache.clear();
  }

  close(): void {
    this.scheduler.stop();
    this.db.close();
  }
}
