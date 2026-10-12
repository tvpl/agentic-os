// A stand-in for lib/mordomo.mjs that speaks the sidecar protocol the way the real service does
// (.specs/features/distribuicao, door 7), with a failure mode picked by FAKE_MODE.
import http from "node:http";

const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--port") + 1]);
const mode = process.env.FAKE_MODE ?? "ok";
const secret = process.env.MORDOMO_LAUNCH_TOKEN ?? "";

console.log(`PID ${process.pid}`);
console.log(`ARGV ${JSON.stringify(args)}`);
console.log(`SECRET_LEN ${secret.length}`);
console.log(`NODE_OPTIONS ${process.env.NODE_OPTIONS ?? "unset"}`);

if (mode.startsWith("exit")) {
  console.error(`the service says it is ending with ${mode.slice(4)}`);
  process.exit(Number(mode.slice(4)));
}
if (mode === "busy-if-port" && port !== 0) {
  console.error(`port ${port} is already in use`);
  process.exit(5);
}
if (mode === "silent") {
  setInterval(() => {}, 1000);
} else {
  const server = http.createServer((req, res) => {
    if (mode === "json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    } else {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<!doctype html><title>Command Centre</title>");
    }
  });
  server.listen(port, "127.0.0.1", () => {
    const bound = server.address().port;
    if (mode === "badready") console.log("MORDOMO_READY {nope");
    else
      console.log(
        `MORDOMO_READY ${JSON.stringify({ v: 1, pid: process.pid, port: bound, version: "9.9.9", updatesCheck: false })}`,
      );
    if (mode === "dies") setTimeout(() => process.exit(7), 300);
  });
  if (mode === "stubborn") {
    process.stdin.on("end", () => {}); // ignores EOF: the supervisor has to kill it
    process.stdin.resume();
  } else {
    process.stdin.on("end", () => server.close(() => process.exit(0)));
    process.stdin.resume();
  }
}
