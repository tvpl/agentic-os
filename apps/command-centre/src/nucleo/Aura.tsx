/**
 * The aura (immersive shell): the agent is present in every scene, at the
 * edge of the screen. While it works a comet of light runs around the
 * frame; while it answers the frame breathes; when it needs you the top-left
 * corner — where your pendências live — glows amber; an alert flashes the
 * frame red and a finished run sweeps it green. Pure CSS on one element,
 * driven by the shell's `data-core` and the pendências level.
 */
export default function Aura() {
  return (
    <div className="nu-aura" aria-hidden>
      <span className="nu-aura-ring" />
      <span className="nu-aura-corner" />
    </div>
  );
}
