# Kleio Framework

## Current release — 5.60.2-kleio.1

`main` carries upstream engine **5.60.2** (`fdab3f18ff204fbae2846686a7a7a2a3e8e04d94`).
The five fixed `@kleio/*` packages are versioned `<engine>-kleio.<n>`, currently
**5.60.2-kleio.1**. Provenance and the import history are in [UPSTREAM.md](UPSTREAM.md).

This fork maintains standalone **Kleio Manager**, Editor, the Premiere panel,
Pixel and its language SDKs/server, Voice, Coder Eyes, Matey, and experiments,
even though upstream retired them. They remain workspace projects with their
commands, exports, tests, and supporting assets, not archives. The separate
Kleio Desktop Manager surface and its dependency pins are unchanged.

The imported [GG App](gg-app/) uses the same shared Kleio engine. Its source and
upstream branding are retained; it is not Kleio Desktop, and its publication
workflow is restricted to the upstream repository. Building its source does not
authorize signing, releasing, installation, or deployment.

<p align="center">
  <strong>Modular TypeScript framework for building LLM-powered apps. From raw streaming to a full coding agent.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@kleio/coder"><img src="https://img.shields.io/npm/v/@kleio/coder?style=for-the-badge&label=Kleio%20Coder" alt="Kleio Coder npm version"></a>
  <a href="https://www.npmjs.com/package/@kleio/manager"><img src="https://img.shields.io/npm/v/@kleio/manager?style=for-the-badge&label=Kleio%20Manager" alt="Kleio Manager npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
  <a href="https://github.com/fmckie/gg-framework"><img src="https://img.shields.io/badge/Source-GitHub-181717?style=for-the-badge&logo=github&logoColor=white" alt="Source on GitHub"></a>
</p>

Each package works on its own. Stack them together and you get a full coding agent—or a manager that drives many agents at once.

| Package                                                          | What it does                                             | README                                           |
| ---------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------ |
| [`@kleio/ai`](https://www.npmjs.com/package/@kleio/ai)           | Unified LLM streaming API across providers               | [packages/gg-ai](packages/gg-ai/README.md)       |
| [`@kleio/agent`](https://www.npmjs.com/package/@kleio/agent)     | Agent loop with multi-turn tool execution                | [packages/gg-agent](packages/gg-agent/README.md) |
| [`@kleio/coder`](https://www.npmjs.com/package/@kleio/coder)     | Kleio Coder CLI with OAuth, tools, and TUI               | [packages/ggcoder](packages/ggcoder/README.md)   |
| [`@kleio/manager`](https://www.npmjs.com/package/@kleio/manager) | Kleio Manager orchestration for many Kleio Coder workers | [packages/gg-boss](packages/gg-boss/README.md)   |

```text
@kleio/ai (standalone)
  └─► @kleio/agent
        └─► @kleio/coder
              └─► @kleio/manager (orchestrates many Kleio Coder workers)
```

---

## Choose a layer

| You want to...                                                  | Use                                            |
| --------------------------------------------------------------- | ---------------------------------------------- |
| Stream LLM responses across providers with one API              | [`@kleio/ai`](packages/gg-ai/README.md)        |
| Build an agent that calls tools and loops autonomously          | [`@kleio/agent`](packages/gg-agent/README.md)  |
| Use a ready-made CLI coding agent                               | [`@kleio/coder`](packages/ggcoder/README.md)   |
| Drive many coding agents across multiple projects from one chat | [`@kleio/manager`](packages/gg-boss/README.md) |

Install only what you need:

```bash
npm i @kleio/ai           # Streaming layer
npm i @kleio/agent        # Streaming + agent loop
npm i -g @kleio/coder     # Kleio Coder CLI
npm i -g @kleio/manager   # Kleio Manager CLI
```

The preferred commands are `kleio-coder` and `kleio-manager`.

---

## Command compatibility

The legacy `ggcoder` and `ggboss` executables remain compatibility aliases for existing scripts and installations. They run the same entry points and use the same `.gg` state as `kleio-coder` and `kleio-manager`. Use the Kleio commands in new documentation and automation.

Repository directories remain [`packages/ggcoder`](packages/ggcoder) and [`packages/gg-boss`](packages/gg-boss) to preserve the upstream-sync seam.

---

## 🧱 The framework underneath

The desktop app forks **zero** agent logic. Windows, IPC and UI live in `gg-app/`; everything else is the exact same spine the CLI runs, and the engine layers are independently packaged; this local integration is not published.

```
Imported GG App (not Kleio Desktop)
  └── @kleio/coder (CLI + app sidecar)
        ├── @kleio/ai (standalone)
        ├── @kleio/agent ──► @kleio/ai
        └── @kleio/core  ──► @kleio/ai
```

| Package                                                    | What it does                                            |
| ---------------------------------------------------------- | ------------------------------------------------------- |
| [`@kleio/ai`](packages/gg-ai/README.md)                    | One streaming API for every provider up there           |
| [`@kleio/agent`](packages/gg-agent/README.md)              | Agent loop with multi-turn tool execution               |
| [`@kleio/core`](https://www.npmjs.com/package/@kleio/core) | Shared guts: model registry, OAuth, auth storage, paths |
| [`@kleio/coder`](packages/ggcoder/README.md)               | The CLI, plus the sidecar the desktop app runs          |

<details>
<summary><strong>👨‍💻 Run it from source</strong></summary>

```bash
git clone https://github.com/fmckie/gg-framework.git
cd gg-framework
pnpm install
pnpm --filter @kleio/coder build   # build the sidecar first
cd gg-app && pnpm tauri dev
```

```bash
pnpm build      # build all packages (gg-ai → gg-agent + gg-core → ggcoder)
pnpm check      # typecheck
pnpm test       # vitest
pnpm lint
```

TypeScript 5.9 · pnpm workspaces · Tauri 2 · React 19 · Vite 7 · Ink 6 · Vitest 4 · Zod v4

Packaging (bundled Node runtime, single-file sidecar, code signing) is in
[gg-app/DISTRIBUTION.md](gg-app/DISTRIBUTION.md). README art is generated by
`node gg-app/scripts/render-readme-art.mjs`; product shots by
`node gg-app/scripts/capture-screenshots.mjs`.

</details>

---

## Support and provenance

- [Source](https://github.com/fmckie/gg-framework)
- [Issues](https://github.com/fmckie/gg-framework/issues)
- [Fork lineage and upstream policy](UPSTREAM.md)

MIT licensed. Use it, change it, ship it.

---

<p align="center">
  <strong>Less bloat. More coding. One Kleio framework.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@kleio/coder"><img src="https://img.shields.io/badge/Install-npm%20i%20--g%20%40kleio%2Fcoder-blue?style=for-the-badge" alt="Install Kleio Coder"></a>
  <a href="https://www.npmjs.com/package/@kleio/manager"><img src="https://img.shields.io/badge/Orchestrate-npm%20i%20--g%20%40kleio%2Fmanager-7C3AED?style=for-the-badge" alt="Install Kleio Manager"></a>
</p>
