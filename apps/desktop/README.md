# MordomoOS desktop (Tauri 2)

A window around the same local service the CLI starts. It does not contain the product: it starts the bundled service
as a child on a loopback port with a secret made for that launch, shows the Command Centre, and stops the service when
it closes. Design, protocol and limits: [`docs/release.md`](../../docs/release.md) §7; the feature's plan, checks and
screens: `.specs/features/distribuicao/`.

```
shell-core/   the part with no webview: launch token, ready line, supervisor, address policy (cargo test needs no display)
src-tauri/    the Tauri app: window, menu, single instance, the three commands of its own screens, the updater (feature `updater`)
ui/           the shell's two screens (starting, failure): static files under a strict content-security-policy
smoke/gui.sh  the Linux window test (Xvfb, a window manager, D-Bus, xdotool)
```

```bash
npm run build && npm run desktop:payload          # the folder the app carries (apps/desktop/payload, not committed)
cd apps/desktop
cargo test -p mordomo-shell-core                  # the supervisor against a real Node and a stand-in service
cargo build -p mordomo-desktop                    # needs libwebkit2gtk-4.1-dev on Linux (docs/release.md)
MORDOMO_DESKTOP_PAYLOAD=$PWD/payload ./target/debug/mordomo-desktop              # a debug build reads its payload from here
MORDOMO_HOME=$(mktemp -d) MORDOMO_DESKTOP_PAYLOAD=$PWD/payload ./target/debug/mordomo-desktop --self-test
smoke/gui.sh ./target/debug/mordomo-desktop payload
```

Installers are built by `node scripts/desktop-build.mjs --platform <p>` (what the release workflow runs) and signed only with
the secrets of `docs/release.md` §2. Keep `target/` out of the commit and out of the way: it is several gigabytes.
