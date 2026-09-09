/** Static supervisor program, passed to Node without interpolating provider input.
 * argv carries executable/arguments separately. Keeping the source here lets
 * source-mode development and the compiled server use the identical guardian.
 */
export const GUARDIAN_SOURCE = String.raw`
const { spawn } = require('node:child_process');
const [executable, ...args] = process.argv.slice(1);
if (!executable || !process.send || process.platform === 'win32') process.exit(125);
let stopping = false;
let finished = false;
let escalation;
const killOwnedGroup = () => {
  try { process.kill(-process.pid, 'SIGKILL'); } catch { process.exit(125); }
};
const stop = () => {
  if (stopping) return;
  stopping = true;
  try { process.kill(-process.pid, 'SIGTERM'); } catch {}
  escalation = setTimeout(killOwnedGroup, 5000);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.on('disconnect', stop);
const finish = (exitCode, signal) => {
  if (finished) return;
  finished = true;
  if (escalation) clearTimeout(escalation);
  if (process.connected && process.send) {
    process.send({type:'provider_exit', exitCode, signal}, () => killOwnedGroup());
    setTimeout(killOwnedGroup, 1000);
  } else killOwnedGroup();
};
const env = {...process.env};
delete env.NODE_CHANNEL_FD;
delete env.NODE_CHANNEL_SERIALIZATION_MODE;
const provider = spawn(executable, args, {stdio:[0,1,2], env, shell:false, detached:false});
provider.on('error', error => {
  if (finished) return;
  finished = true;
  if (process.connected && process.send) {
    process.send({type:'provider_error', message:error.message, code:error.code}, () => killOwnedGroup());
    setTimeout(killOwnedGroup, 1000);
  } else killOwnedGroup();
});
provider.on('exit', finish);
`;
