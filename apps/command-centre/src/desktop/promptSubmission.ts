const KEY = "mordomo.promptSubmission.v1";
interface Submission {
  fingerprint: string;
  id: string;
}

export function loadPromptSubmission(scope = "console"): Submission | null {
  try {
    const value = JSON.parse(
      sessionStorage.getItem(scope === "console" ? KEY : `${KEY}.${scope}`) ?? "null",
    ) as Submission | null;
    return value &&
      typeof value.fingerprint === "string" &&
      value.fingerprint.length <= 25_000 &&
      typeof value.id === "string" &&
      /^[0-9a-f-]{36}$/i.test(value.id)
      ? value
      : null;
  } catch {
    return null;
  }
}

export function savePromptSubmission(value: Submission | null, scope = "console"): void {
  try {
    if (value) sessionStorage.setItem(scope === "console" ? KEY : `${KEY}.${scope}`, JSON.stringify(value));
    else sessionStorage.removeItem(scope === "console" ? KEY : `${KEY}.${scope}`);
  } catch {
    /* The current mounted console still retains its submission identity. */
  }
}
