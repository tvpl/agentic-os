import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { planStartupService, isStartupServiceInstalled } from "../core/src/routines/osIntegration.js";
import { makeTempHome } from "./helpers.js";

for (const platform of ["darwin", "linux"] as const) {
  it(`${platform} only reports a service belonging to the current OS home`, () => {
    const first = makeTempHome();
    const second = makeTempHome();
    try {
      const userHome = path.join(first.paths.home, "user");
      const file = planStartupService(first.paths, process.execPath, platform, userHome).files[0]!;
      fs.mkdirSync(path.dirname(file.path), { recursive: true });
      fs.writeFileSync(file.path, file.content);
      expect(isStartupServiceInstalled(first.paths, platform, userHome)).toBe(true);
      expect(isStartupServiceInstalled(second.paths, platform, userHome)).toBe(false);
    } finally {
      first.cleanup();
      second.cleanup();
    }
  });
}
