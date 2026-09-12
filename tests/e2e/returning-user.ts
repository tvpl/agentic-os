/**
 * Browser storage of a user who already finished the interactive OS guide.
 * Most workflows model a returning user; the onboarding spec starts fresh.
 */
export function returningUserState(origin: string) {
  return {
    cookies: [],
    origins: [
      {
        origin,
        localStorage: [
          {
            name: "mordomo.onboarding.v1",
            value: JSON.stringify({
              version: 1,
              status: "completed",
              step: 12,
              visited: [],
              practiced: false,
            }),
          },
        ],
      },
    ],
  };
}
