# Adding a provider adapter

Adapters make MordomoOS vendor-neutral: each provider is a package in
`adapters/<id>/` implementing the `AgentAdapter` interface from
`@mordomo/core` — the core, API, UI, skills, memory and routines never change.

## The contract

```ts
interface AgentAdapter {
  id: ProviderId;
  detect(): Promise<DetectionResult>;        // PATH lookup, --version, --help flag probing
  authenticate(): Promise<AuthStatus>;       // presence checks ONLY — never read/print credentials
  listModels(): Promise<ModelOption[]>;
  validateConfig(): Promise<ValidationResult>;
  buildInvocation(run: AgentRun): Promise<SafeInvocation>;  // executable + argv array + env
  execute(run: AgentRun): AsyncIterable<RunEvent>;
  cancel(runId: string): Promise<void>;
  healthCheck(): Promise<HealthStatus>;
}
```

Normalize: prompt, cwd, model, effort, read-only vs write mode, timeout,
streamed events (`started`, `assistant`, `tool_use`, `permission`, `text`,
`result`, `error`), exit code, cancellation.

## Steps

1. `mkdir adapters/<id>` with a `package.json`/`tsconfig.json` copied from an
   existing adapter; depend on `@mordomo/core`.
2. Implement the class. Use the shared helpers — they give you the safety
   rails for free:
   - `findOnPath` + `probe(binary, ["--help"], …)` + `parseHelpFlags` for
     detection. **Never assume a flag exists** — check `supportedFlags` and
     degrade or refuse with a clear note.
   - `executeInvocation(run, invocation, parser)` for streaming: it spawns via
     the allowlisted argv-only layer, handles timeouts/kill-tree, registers
     the run for `cancelRunProcess(runId)`, and turns stdout lines into events
     through your `LineParser`.
3. Enforce the mode. `read_only` must be *mechanically* enforced (sandbox
   flag, permission rules, or at minimum never passing the provider's
   auto-apply flag). If the installed CLI cannot enforce it, throw — do not
   silently run writable. Never use full-bypass flags.
4. Map `effort` only if the provider supports it; otherwise ignore it and say
   so in `detect().notes`.
5. Describe and register it. Declare the package's `ProviderManifest` in
   `adapters/<id>/src/manifest.ts` (identity, binary, `installHint`,
   `loginCommand`, `capabilities`, native `layout`, `homeConfigFiles`,
   `writeToolPattern` — see `core/src/agents/registry.ts`) and export it from
   the package's index as `<id>Manifest`, next to a factory
   `create<Name>Adapter(opts)`; give the class a `readonly manifest` and an `id`
   equal to the manifest's (the registry refuses an adapter whose `id` differs).
   Then register the pair in `apps/api/src/providers.ts`. The id only has to be
   well formed (`ProviderId`: 2-32 lowercase letters, digits or dashes); there
   is no list of ids to edit. The sync compiler, the connector auditor, the run
   manager's write detection, the executable allowlist (the manifest's `binary`),
   the CLI's `--provider`, the Command Centre's provider lists and
   `/api/providers` all read the registry — nothing else in core, in the API or
   in the UI changes.
6. Test it against a **fake CLI**: add an executable script to
   `tests/fixtures/fake-bin/` that answers `--version`, `--help` and emits the
   provider's real streaming shapes, and mirror `tests/adapters.test.ts`. A test
   that drives the adapter without an engine allowlists the binary itself with
   `setProviderBinaries` (see `tests/helpers.ts`); `tests/providers.pluggable.test.ts`
   registers a provider that ships nowhere but the test.

## Rules

- Auth detection is presence-only (config files, env var names). Credential
  *values* must never be read, logged or stored.
- Everything you print in notes/details reaches logs — keep it credential-free.
- The adapter receives `run.artifactsDir`; make sure the invocation allows
  writing there even in read-only mode (that's where skill outputs land).
