/**
 * Freeze a plain value all the way down: objects and arrays that are plain data, never a class instance (a zod schema
 * keeps its own state). The route table and the version lists are constants of the contract; a client or a test that
 * writes into one would change what the server and the document say for everybody (`Object.freeze` throws in strict
 * mode, which every module is).
 */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== Array.prototype) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
