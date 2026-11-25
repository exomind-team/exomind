# ExoMind

ExoMind helps you keep a local record of events, attachments and time blocks, then pick up that record on another authorized device. Computer, tablet and phone can each hold a copy of a profile. The project combines a Rust/SQLite core with React, TypeScript and Tauri 2.

[中文](README-zh.md) · [Website](https://exo-mind.ai) · [Public downloads](https://github.com/exomind-team/exomind/releases) · [License](LICENSE)

## Try the 0.6 Beta

For an installable candidate, check the application source, build recipe, platform and artifact in the [version and delivery record](docs/AI-CONTEXT.md). The build workflow publishes validation artifacts. Public releases have their own [release pages](https://github.com/exomind-team/exomind/releases). For your first session, create a profile, save a short note and a picture, and open both on the receiving device. [First session guide](docs/product/beta-first-session.md) · [macOS installation](docs/macos-install.md)

## Quick Start

With Node and Bun installed, run from the repository root:

```sh
bun install
bun run dev --host 127.0.0.1 --port 4300 --strictPort
```

Open `http://127.0.0.1:4300/beta.html?mock=1`. The banner identifies the in-memory test profile. Reloading the page resets this example. To verify persistence, use a real Beta Host with a new absolute data directory. The development guide includes the exact commands and a first check. [Developer quick start](docs/development/quickstart.md)

| Goal | Entry point |
|---|---|
| Beta application UI | [`src/beta`](src/beta/README.md), loaded by [`beta.html`](beta.html) |
| Durable local records, time blocks and receipts | [Beta Core](crates/exomind-core/README.md) |
| Authorized API, peer sync and original files | [Beta Host](crates/exomind-beta-host/README.md) · [Architecture guide](docs/architecture/README.md) |
| Native desktop or Android build | [Build guide](BUILD.md) · [Runtime and platform checks](docs/development/beta-iteration-guards.md) |
| Existing Alpha or 0.5 software | The default `index.html` and default Tauri features serve the Alpha/legacy line. [Historical architecture](docs/architecture/overview.md) |
| Standalone migration prototype | [`next/`](next/README.md) has its own Node runtime and data directory. |

## Contributing

Most technical documentation is in Chinese. Start with the [documentation index](docs/README.md), [repository contributor rules](AGENTS.md) and [iteration plans](docs/plans/README.md). Related projects include [ExoMind Cell](https://github.com/exomind-team/exomind-cell) and [Wattson](https://github.com/exomind-team/wattson).

[QQ community](https://qm.qq.com/q/cmPIiH5BpS) · [WeChat](docs/wechat.md) · [CCOPL-1.0](LICENSE) · [中文许可证](LICENSE-zh)
