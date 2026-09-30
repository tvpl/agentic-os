/**
 * A schedule in words (refino item 42): "toda segunda às 8", "every day at
 * 9:30", "de segunda a sexta às 18h", "a cada hora" → a 5-field cron. Small
 * vocabulary in pt-BR and en; unknown phrases return null and the form
 * keeps its cron field. Pure and tested.
 */
const DAYS: Array<[RegExp, number]> = [
  [/\b(domingo|sunday|sun)\b/i, 0],
  [/\b(segunda|monday|mon)\b/i, 1],
  [/\b(ter[çc]a|tuesday|tue)\b/i, 2],
  [/\b(quarta|wednesday|wed)\b/i, 3],
  [/\b(quinta|thursday|thu)\b/i, 4],
  [/\b(sexta|friday|fri)\b/i, 5],
  [/\b(s[áa]bado|saturday|sat)\b/i, 6],
];

export function naturalToCron(text: string): string | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  // "a cada hora" / "every hour" / "a cada 30 minutos" / "every 15 minutes"
  const everyMin = /(?:a cada|every|cada)\s+(\d+)\s*(?:min|minutos?|minutes?)/.exec(t);
  if (everyMin) return `*/${Math.max(1, Math.min(59, Number(everyMin[1])))} * * * *`;
  if (/(?:a cada|every|cada)\s+hora|hourly|de hora em hora/.test(t)) return "0 * * * *";
  const everyH = /(?:a cada|every|cada)\s+(\d+)\s*(?:h|horas?|hours?)\b/.exec(t);
  if (everyH) return `0 */${Math.max(1, Math.min(23, Number(everyH[1])))} * * *`;

  const time =
    /(?:às|as|at|@)\s*(\d{1,2})(?::(\d{2}))?\s*(h|am|pm)?/.exec(t) ?? /\b(\d{1,2}):(\d{2})\b/.exec(t);
  let hour = 9;
  let minute = 0;
  if (time) {
    hour = Number(time[1]);
    minute = time[2] ? Number(time[2]) : 0;
    if (time[3] === "pm" && hour < 12) hour += 12;
    if (time[3] === "am" && hour === 12) hour = 0;
    if (hour > 23 || minute > 59) return null;
  }
  // Ranges: "de segunda a sexta", "monday to friday", "dias úteis", "weekdays"
  if (/dias? [úu]teis|weekdays?|de segunda a sexta|monday to friday|mon-fri|seg a sex/.test(t))
    return `${minute} ${hour} * * 1-5`;
  if (/fins? de semana|weekends?/.test(t)) return `${minute} ${hour} * * 0,6`;
  const found = DAYS.filter(([re]) => re.test(t)).map(([, d]) => d);
  if (found.length > 0) return `${minute} ${hour} * * ${[...new Set(found)].sort().join(",")}`;
  if (
    /todo dia|todos os dias|diariamente|daily|every day|cada dia|toda manhã|every morning|toda noite|every night/.test(
      t,
    )
  )
    return `${minute} ${hour} * * *`;
  if (/todo m[êe]s|mensal|monthly|every month/.test(t)) return `${minute} ${hour} 1 * *`;
  if (time) return `${minute} ${hour} * * *`;
  return null;
}
