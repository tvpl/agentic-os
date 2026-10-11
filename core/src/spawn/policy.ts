import {
  assertAllowed,
  safeSpawn,
  type SpawnHandle,
  type SpawnOptions,
  type SpawnResult,
} from "./safeSpawn.js";

/** Variables of this process a child must not inherit: exact names and name prefixes. */
export interface DropEnv {
  names: string[];
  prefixes: string[];
}

/**
 * What ONE engine lets its children be and know: the executables its providers run, by name (plus `node`),
 * and the environment its probes (`--version`, `--help`, `auth status`) do not inherit.
 *
 * It belongs to the engine that built it and is handed to that engine's adapters (`AdapterFactoryOptions.spawn`),
 * so two engines in one process, with different providers or different settings, never change each other's
 * allowlist. The engine updates it when the registry or the settings change (`reloadAdapters`).
 */
export class SpawnPolicy {
  private binaries: ReadonlySet<string>;
  private drop: DropEnv;

  constructor(init: { binaries?: Iterable<string>; probeEnvDrop?: DropEnv } = {}) {
    this.binaries = new Set(init.binaries ?? []);
    this.drop = cloneDrop(init.probeEnvDrop ?? { names: [], prefixes: ["MORDOMO_"] });
  }

  /** Replace the executable names this policy allows besides `node`. */
  setBinaries(names: Iterable<string>): void {
    this.binaries = new Set(names);
  }

  /** Replace what a probe does not inherit. */
  setProbeEnvDrop(drop: DropEnv): void {
    this.drop = cloneDrop(drop);
  }

  /** What a probe does not inherit (a copy). */
  get probeEnvDrop(): DropEnv {
    return cloneDrop(this.drop);
  }

  /** Whether `name` (an executable's basename, see `executableName`) is one of the allowed provider binaries. */
  allows(name: string): boolean {
    return this.binaries.has(name);
  }

  /** Throws `ExecutableNotAllowedError` unless the executable is `node`, an allowed binary or one of `allowPaths`. */
  assertAllowed(executable: string, allowPaths: string[] = []): void {
    assertAllowed(executable, allowPaths, this);
  }

  /** `safeSpawn` under this policy. */
  spawn(executable: string, args: string[], opts: SpawnOptions): SpawnHandle {
    return safeSpawn(executable, args, { ...opts, policy: this });
  }

  /** A short, non-streamed run of a provider CLI (`--version`, `--help`, `auth status`) that drops this policy's environment. */
  probe(executable: string, args: string[], cwd: string, timeoutMs = 15_000): Promise<SpawnResult> {
    return this.spawn(executable, args, { cwd, timeoutMs, dropEnv: this.probeEnvDrop }).result;
  }
}

function cloneDrop(drop: DropEnv): DropEnv {
  return { names: [...drop.names], prefixes: [...drop.prefixes] };
}
