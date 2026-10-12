import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

/**
 * distribuicao, S6: what the release workflow guarantees (.specs/features/distribuicao, AC 37-42). The workflow is parsed,
 * not grepped: a step is a step, a secret is a reference in an `env` value.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");

interface Step {
  name?: string;
  id?: string;
  uses?: string;
  if?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
}
interface Job {
  name?: string;
  needs?: string | string[];
  if?: string;
  permissions?: Record<string, string>;
  outputs?: Record<string, string>;
  "runs-on"?: string;
  strategy?: { matrix?: { include?: Array<{ platform: string; os: string }> } };
  steps: Step[];
}
interface Workflow {
  on: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs: Record<string, Job>;
}

const releaseText = read(".github/workflows/release.yml");
const ciText = read(".github/workflows/ci.yml");
const release = YAML.parse(releaseText) as Workflow;
const ci = YAML.parse(ciText) as Workflow;
const stepsOf = (wf: Workflow) =>
  Object.entries(wf.jobs).flatMap(([job, j]) => j.steps.map((s) => ({ job, ...s })));
const SECRET = /secrets\.([A-Z0-9_]+)/g;
const secretsIn = (value: unknown): string[] =>
  [...JSON.stringify(value ?? "").matchAll(SECRET)].map((m) => m[1]!);

describe("C36 the release runs on a v* tag, by hand without publishing, and nowhere else", () => {
  it("C36 the triggers are a push of v* tags and workflow_dispatch, nothing more", () => {
    expect(Object.keys(release.on).sort()).toEqual(["push", "workflow_dispatch"]);
    expect(release.on.push).toEqual({ tags: ["v*"] });
    for (const never of [
      "pull_request",
      "pull_request_target",
      "schedule",
      "workflow_run",
      "repository_dispatch",
      "release",
    ])
      expect(release.on, never).not.toHaveProperty(never);
  });

  it("C36 the publishing job exists, needs the builds, and runs only on a tag ref; a manual run never reaches it", () => {
    const publish = release.jobs.publish!;
    expect(publish.if).toBe("github.ref_type == 'tag'");
    expect(publish.needs).toEqual(["plan", "package"]);
    for (const [name, job] of Object.entries(release.jobs))
      if (name !== "publish") expect(job.if ?? "", name).not.toMatch(/ref_type == 'tag'/);
  });

  it("C37 permissions: contents read at the top, contents write only in the publishing job, no other grant anywhere", () => {
    expect(release.permissions).toEqual({ contents: "read" });
    // two runs of one tag never overwrite each other's draft half way
    expect((release as unknown as { concurrency: unknown }).concurrency).toEqual({
      group: "release-${{ github.ref }}",
      "cancel-in-progress": false,
    });
    for (const [name, job] of Object.entries(release.jobs)) {
      if (name === "publish") expect(job.permissions).toEqual({ contents: "write" });
      else expect(job.permissions, name).toBeUndefined();
    }
    expect(releaseText).not.toMatch(/id-token|pull-requests:|packages:|actions: write|write-all/);
  });

  it("C37 the release only ever drafts: --draft on create and edit, no publish, no --latest, and a published release is refused", () => {
    const run = release.jobs.publish!.steps.map((s) => s.run ?? "").join("\n");
    expect(run).toMatch(/gh release create "\$TAG" --draft --verify-tag/);
    expect(run).toMatch(/gh release edit "\$TAG" --draft/);
    expect(run).not.toMatch(/--draft=false|--latest|--prerelease|gh release (publish|delete)|--publish/);
    expect(run).toMatch(/already published; this workflow only writes drafts/);
    expect(
      stepsOf(release)
        .filter((s) => /gh release/.test(s.run ?? ""))
        .map((s) => s.job),
    ).toEqual(["publish"]);
  });
});

describe("C38 a secret is named only in the step that needs it", () => {
  // step -> secrets; the plan step only asks whether each exists (`!= ''`), it never passes a value on
  const EXPECTED: Record<string, string[]> = {
    "Which signing material is registered": [
      "APPLE_APP_PASSWORD",
      "APPLE_ID",
      "APPLE_TEAM_ID",
      "MACOS_CERT_P12_BASE64",
      "MACOS_CERT_PASSWORD",
      "MACOS_SIGN_IDENTITY",
      "TAURI_SIGNING_PRIVATE_KEY",
      "WINDOWS_CERT_PASSWORD",
      "WINDOWS_CERT_PFX_BASE64",
    ],
    "Import the Developer ID certificate": ["MACOS_CERT_P12_BASE64", "MACOS_CERT_PASSWORD"],
    "Import the Authenticode certificate": ["WINDOWS_CERT_PASSWORD", "WINDOWS_CERT_PFX_BASE64"],
    "Payload (macOS, signed native code)": ["MACOS_SIGN_IDENTITY"],
    "Build installers (macOS)": [
      "APPLE_APP_PASSWORD",
      "APPLE_ID",
      "APPLE_TEAM_ID",
      "MACOS_SIGN_IDENTITY",
      "TAURI_SIGNING_PRIVATE_KEY",
      "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
    ],
    "Build installers (Windows)": ["TAURI_SIGNING_PRIVATE_KEY", "TAURI_SIGNING_PRIVATE_KEY_PASSWORD"],
    "Build installers (Linux)": ["TAURI_SIGNING_PRIVATE_KEY", "TAURI_SIGNING_PRIVATE_KEY_PASSWORD"],
  };

  it("C38 the steps that reference a secret are exactly these, with exactly these secrets", () => {
    const found: Record<string, string[]> = {};
    for (const step of stepsOf(release)) {
      const names = [
        ...new Set(secretsIn({ env: step.env, with: step.with, run: step.run, if: step.if })),
      ].sort();
      if (names.length > 0) found[step.name ?? "(unnamed)"] = names;
    }
    expect(found).toEqual(EXPECTED);
  });

  it("C38 a secret is never in a script, a condition or a `with`: only in an `env` value; and no step traces or echoes", () => {
    for (const step of stepsOf(release)) {
      expect(secretsIn(step.run), `${step.name} run`).toEqual([]);
      expect(secretsIn(step.if), `${step.name} if`).toEqual([]);
      expect(secretsIn(step.with), `${step.name} with`).toEqual([]);
      expect(step.run ?? "", step.name).not.toMatch(/set -[a-z]*x|bash -x|xtrace|ACTIONS_STEP_DEBUG/);
    }
  });

  it("C38 the plan step asks only whether a secret exists (`!= ''`), and the outputs it hands on are the four booleans", () => {
    const plan = stepsOf(release).find((s) => s.name === "Which signing material is registered")!;
    for (const [key, value] of Object.entries(plan.env ?? {}))
      if (key.startsWith("HAS_"))
        expect(value.replace(SECRET, "SECRET")).toMatch(/^\$\{\{ SECRET != ''( && SECRET != '')* \}\}$/);
    expect(Object.keys(release.jobs.plan!.outputs ?? {}).sort()).toEqual([
      "mac_notarize",
      "mac_signed",
      "updater",
      "version",
      "windows_signed",
    ]);
    // the others get the flags, never the secrets of another platform
    const windows = stepsOf(release).find((s) => s.name === "Build installers (Windows)")!;
    expect(Object.keys(windows.env!).some((k) => k.startsWith("APPLE_"))).toBe(false);
    const linux = stepsOf(release).find((s) => s.name === "Build installers (Linux)")!;
    expect(Object.keys(linux.env!).some((k) => /^(APPLE_|WINDOWS_)/.test(k))).toBe(false);
  });
});

describe("C39 every action is a major tag of actions/* or a pinned commit", () => {
  for (const [file, wf] of [
    ["release.yml", release],
    ["ci.yml", ci],
  ] as const)
    it(`C39 ${file}: uses is actions/<name>@v<N>, or <owner>/<name>@<40 hex> (a third party is never a moving tag)`, () => {
      const uses = stepsOf(wf).flatMap((s) => (s.uses ? [s.uses] : []));
      expect(uses.length).toBeGreaterThan(0);
      for (const use of uses) {
        if (use.startsWith("actions/")) expect(use, use).toMatch(/^actions\/[a-z-]+@v\d+$/);
        else expect(use, use).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
      }
    });

  it("C39 the secrets of signing reach no third-party action: the release uses first-party actions only", () => {
    const thirdParty = stepsOf(release).filter((s) => s.uses && !s.uses.startsWith("actions/"));
    expect(thirdParty).toEqual([]);
  });
});

describe("C40 without a signing secret a platform still builds, labelled, and the signing steps do not run", () => {
  it("C40 the certificate imports and the signed payload run only when the plan says the material is there", () => {
    const step = (name: string) => stepsOf(release).find((s) => s.name === name)!;
    expect(step("Import the Developer ID certificate").if).toBe(
      "runner.os == 'macOS' && needs.plan.outputs.mac_signed == 'true'",
    );
    expect(step("Import the Authenticode certificate").if).toBe(
      "runner.os == 'Windows' && needs.plan.outputs.windows_signed == 'true'",
    );
    expect(step("Payload (macOS, signed native code)").if).toBe(
      "runner.os == 'macOS' && needs.plan.outputs.mac_signed == 'true'",
    );
    expect(step("Payload").if).toBe("runner.os != 'macOS' || needs.plan.outputs.mac_signed != 'true'");
    expect(step("Verify the signature and the notarization (macOS)").if).toBe(
      "runner.os == 'macOS' && needs.plan.outputs.mac_signed == 'true'",
    );
    expect(step("Verify the Authenticode signature (Windows)").if).toBe(
      "runner.os == 'Windows' && needs.plan.outputs.windows_signed == 'true'",
    );
  });

  it("C40 the installers are built through scripts/desktop-build.mjs, which drops unregistered material, and named by release-collect with the flags of the plan", () => {
    for (const name of [
      "Build installers (macOS)",
      "Build installers (Windows)",
      "Build installers (Linux)",
    ]) {
      const step = stepsOf(release).find((s) => s.name === name)!;
      expect(step.run).toBe("node scripts/desktop-build.mjs --platform ${{ matrix.platform }}");
      expect(step.env!.UPDATER_ENABLED).toBe("${{ needs.plan.outputs.updater }}");
    }
    const collect = stepsOf(release).find((s) => s.name === "Name the installers and say what was signed")!;
    for (const flag of ["--code-signed", "--notarized", "--updater-signed", "release-collect.mjs"])
      expect(collect.run).toContain(flag);
    expect(collect.env).toEqual({
      MAC_SIGNED: "${{ needs.plan.outputs.mac_signed }}",
      MAC_NOTARIZE: "${{ needs.plan.outputs.mac_notarize }}",
      WINDOWS_SIGNED: "${{ needs.plan.outputs.windows_signed }}",
    });
    expect(collect.run).toMatch(/Windows\) CODE_SIGNED=\$WINDOWS_SIGNED; NOTARIZED=false/);
    expect(collect.run).toMatch(/\*\) CODE_SIGNED=false; NOTARIZED=false/);
  });

  it("C40 the matrix is the four platforms of the plan on current runners", () => {
    const include = release.jobs.package!.strategy!.matrix!.include!;
    expect(include).toEqual([
      { platform: "macos-arm64", os: "macos-14" },
      { platform: "macos-x64", os: "macos-15-intel" },
      { platform: "windows-x64", os: "windows-2022" },
      { platform: "linux-x64", os: "ubuntu-22.04" },
    ]);
    expect(releaseText).not.toMatch(/macos-13/);
  });
});

describe("C42 what a draft release carries", () => {
  const run = release.jobs.publish!.steps.map((s) => s.run ?? "").join("\n");
  it("C42 notes from the CHANGELOG with the status table, the updater manifest (only when complete), SBOM, both notices and checksums", () => {
    for (const part of [
      'scripts/release-notes.mjs --version "$VERSION" --status artifacts --out notes.md',
      "scripts/updater-manifest.mjs --dir artifacts",
      "--out artifacts/latest.json",
      "scripts/sbom.mjs --out artifacts/sbom.cdx.json",
      "scripts/sbom-rust.mjs --out artifacts/sbom.desktop.cdx.json",
      "legal/THIRD_PARTY_NOTICES.md legal/THIRD_PARTY_NOTICES.desktop.md",
      "sha256sum",
      "SHA256SUMS.txt",
      "--notes-file notes.md artifacts/*",
    ])
      expect(run, part).toContain(part);
    // exit 3 of the manifest script (not complete) is the only status that does not fail the job
    expect(run).toMatch(/\[ "\$status" -ne 0 \] && \[ "\$status" -ne 3 \]/);
    expect(run).toContain("rm -f artifacts/status-*.json");
  });

  it("C42 the artifacts of the four jobs are downloaded merged, and every job uploads with if-no-files-found: error", () => {
    const download = release.jobs.publish!.steps.find((s) => s.uses === "actions/download-artifact@v4")!;
    expect(download.with).toEqual({ pattern: "release-*", path: "artifacts", "merge-multiple": true });
    const upload = release.jobs.package!.steps.find((s) => s.uses === "actions/upload-artifact@v4")!;
    expect(upload.with).toEqual({
      name: "release-${{ matrix.platform }}",
      path: "release/*",
      "if-no-files-found": "error",
    });
  });
});

describe("C44 a tag that is not the version, or a version with no CHANGELOG section, fails before anything is built", () => {
  it("C44 the plan job runs version-sync with the tag and release-notes --check, and every build job needs it", () => {
    const step = stepsOf(release).find((s) => s.name === "Version, tag and CHANGELOG agree")!;
    expect(step.env).toEqual({ TAG: "${{ github.ref_type == 'tag' && github.ref_name || '' }}" });
    expect(step.run).toContain('node scripts/version-sync.mjs --check --tag "$TAG"');
    expect(step.run).toContain('node scripts/release-notes.mjs --version "$VERSION" --check');
    expect(release.jobs.package!.needs).toEqual(["plan", "verify"]);
    expect(release.jobs.verify!.steps.map((s) => s.run)).toEqual(
      expect.arrayContaining([
        "npm run typecheck",
        "npm run lint",
        "npx vitest run",
        "node scripts/licenses.mjs --check",
        "node scripts/licenses-rust.mjs --check --require-cargo",
        "node scripts/network-scan.mjs --check",
      ]),
    );
  });
});

describe("C45 the license and the legal texts are in the payload before an installer is built, in the release and in CI", () => {
  const FILES = [
    "LICENSE",
    "legal/EULA.md",
    "legal/PRIVACY.md",
    "legal/NOTICE.md",
    "legal/THIRD_PARTY_NOTICES.md",
    "legal/THIRD_PARTY_NOTICES.desktop.md",
    "legal/sbom.cdx.json",
    "legal/sbom.desktop.cdx.json",
  ];
  it("C45 release.yml: a step lists all eight files and fails the job when one is missing, between the payload and the build", () => {
    const steps = release.jobs.package!.steps;
    const index = (name: string) => steps.findIndex((s) => s.name === name);
    const check = steps[index("The license and the legal texts are in the payload")]!;
    for (const file of FILES) expect(check.run, file).toContain(file);
    expect(check.run).toMatch(
      /test -f "apps\/desktop\/payload\/\$file" \|\| \{ echo "::error::[^"]*"; exit 1; \}/,
    );
    expect(index("Payload")).toBeLessThan(index("The license and the legal texts are in the payload"));
    expect(index("The license and the legal texts are in the payload")).toBeLessThan(
      index("Build installers (macOS)"),
    );
  });

  it("C45 ci.yml has a desktop job that checks the same eight files and runs the window smoke test", () => {
    const run = ci.jobs.desktop!.steps.map((s) => s.run ?? "").join("\n");
    for (const file of FILES) expect(run, file).toContain(file);
    expect(run).toContain("apps/desktop/smoke/gui.sh");
    expect(run).toContain("cargo test --locked -p mordomo-shell-core");
    expect(run).toContain("node scripts/licenses-rust.mjs --check --require-cargo");
  });

  it("C45 the Rust toolchain installed by the workflows is the one of rust-toolchain.toml", () => {
    const pinned = /channel = "([\d.]+)"/.exec(read("apps/desktop/rust-toolchain.toml"))![1]!;
    for (const text of [releaseText, ciText]) {
      const versions = [...text.matchAll(/rustup toolchain install ([\d.]+)/g)].map((m) => m[1]);
      expect(versions.length).toBeGreaterThan(0);
      expect(new Set(versions)).toEqual(new Set([pinned]));
    }
  });
});
