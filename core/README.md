# @mordomo/core

The MordomoOS engine as a library: start an agent from a program, follow it, cancel it, approve what it wants to
write - with the same write policy, working-folder rules and approvals as the MordomoOS app.

The core knows no provider by name. A provider is a manifest (data) and an adapter factory (code); you register the
ones you want. The adapters for Claude Code, Cursor Agent and Codex live in their own packages in the repository.

```sh
npm install @mordomo/core
```

Node 22 or newer (and, for TypeScript, `@types/node` 22 or newer, which the declarations use). The package is licensed under the [Functional Source License](./LICENSE) (FSL-1.1-ALv2).

## A first run

This example registers a provider that answers inside the process (a real one wraps a CLI), starts a run and waits
for it. It is the example the package's own tests run.

<!-- example:quickstart -->

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ProviderRegistry,
  createEngine,
  type AgentAdapter,
  type AgentRun,
  type ProviderManifest,
  type RunEvent,
} from "@mordomo/core";

// What the engine needs to know about a provider, as data.
const manifest: ProviderManifest = {
  id: "echo",
  displayName: "Echo",
  binary: "echo-cli",
  installHint: "nothing to install: this provider runs in the process",
  loginCommand: "echo login",
  capabilities: {
    enforcesReadOnly: true,
    supportsEffort: false,
    promptTransport: "stdin",
    streaming: true,
    resume: "none",
    writeConfinement: "broker",
    readConfinement: "workdir",
  },
  layout: { instructionsFile: "AGENTS.md", skillsDir: null, rulesFile: null, commandsDir: null },
  homeConfigFiles: [],
  writeToolPattern: /^write/i,
};

// The code: an adapter turns a run into a stream of events.
const adapter: AgentAdapter = {
  id: "echo",
  manifest,
  detect: async () => ({
    installed: true,
    binaryPath: null,
    version: "1.0.0",
    supportedFlags: [],
    notes: [],
  }),
  authenticate: async () => ({ authenticated: true, method: null, detail: "in-process" }),
  listModels: async () => [],
  validateConfig: async () => ({ ok: true, issues: [] }),
  buildInvocation: async () => ({ executable: "node", args: [], env: {}, description: "in-process" }),
  healthCheck: async () => ({
    ok: true,
    installed: true,
    authenticated: true,
    version: "1.0.0",
    detail: "in-process",
    checkedAt: Date.now(),
  }),
  async *execute(run: AgentRun): AsyncIterable<RunEvent> {
    const text = `you asked: ${run.prompt.split("\n")[0]}`;
    yield { type: "text", ts: Date.now(), stream: "stdout", text };
    yield { type: "result", ts: Date.now(), exitCode: 0, summary: text, durationMs: 1, timedOut: false };
  },
};

// An engine works on one home (its database, settings and skills). Here, a throwaway folder.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-readme-"));
const engine = createEngine({
  home,
  providers: new ProviderRegistry().register(manifest, () => adapter),
});

// Providers start disabled: switch this one on and make it the default.
engine.updateSettings({ defaultProvider: "echo", providers: { echo: { enabled: true } } });

engine.start(); // own the home: recover what a dead owner left, start the scheduler
const started = engine.execution.startPrompt({ prompt: "say hi", startedBy: null });
engine.execution.subscribe(started.runId, (event) => {
  if (event.type === "text") console.log(event.text);
});
const run = await engine.execution.wait(started.runId);
console.log(run.status); // done

await engine.stop();
fs.rmSync(home, { recursive: true, force: true });
```

## What the engine decides for you

`engine.execution` applies the rules of the app to every call, so a program that uses the engine cannot go around
them:

- **Writes.** `startPrompt({ mode: "write" })` follows the security profile in the settings: refused (`read_only`),
  parked for a human (`review_before_write`) or run. A parked write comes back as `status: "waiting_approval"` with a
  `pendingApproval`; `resolveApproval` launches that very run (approved) or cancels it (denied).
- **Folders.** `cwd` must be inside the home or an indexed folder, and never `config/` or `logs/`. Without a `cwd`
  the run starts in `<home>/workspace`.
- **Who asked.** `startedBy` is required: `null` for your own program, `"owner"`, or `"device:<id>"` for a paired
  phone. A device only starts runs on a provider whose reads stay in the working folder, always has its writes
  parked, and never approves what it asked for.
- **Retries.** `submissionId` makes `startPrompt` and `retry` idempotent.

Two engines in one process share nothing: events, allowlists and caches belong to the engine that made them. A home
has one owner at a time: a second `start()` on the same home, in this process or another, throws
`EngineLockedError`. Keep the `Engine` you start: `stop()` or `close()` gives the home back, and an engine whose
reference is lost holds it until the process ends.

## Where to read more

- [docs/sdk.md](https://github.com/tvpl/agentic-os/blob/main/docs/sdk.md): every export, with what it throws.
- `@mordomo/core/internal` is what the MordomoOS app and the adapter packages use. It has no stability promise;
  anything you need from it is a candidate for the public surface, so say so.
