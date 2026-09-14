/**
 * The agent's presence (redesign F4b).
 *
 * It replaces the icosphere: 837 lines of wireframe geometry, a particle
 * core, a tick ring and an orbital ring of file chips, animating full-screen
 * behind the desktop. The chips navigated away instead of doing anything with
 * the file, and the sphere's only irreplaceable job was telling you the agent
 * was busy without words.
 *
 * That job is kept here — a warm breath behind the console, driven by the
 * same `CoreState` — for one element and no canvas. The `data-core` attribute
 * on the desktop drives the animation entirely from CSS, so an idle desktop
 * costs nothing at all.
 */
export default function AgentPresence() {
  return <div className="agent-presence" aria-hidden />;
}
