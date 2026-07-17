# GG Framework

<p align="center">
  <strong>Modular TypeScript framework for building LLM-powered apps. From raw streaming to full coding agent.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@kleio/coder"><img src="https://img.shields.io/npm/v/@kleio/coder?style=for-the-badge&label=ggcoder" alt="ggcoder npm version"></a>
  <a href="https://www.npmjs.com/package/@kleio/manager"><img src="https://img.shields.io/npm/v/@kleio/manager?style=for-the-badge&label=gg-boss" alt="gg-boss npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
  <a href="https://youtube.com/@kenkaidoesai"><img src="https://img.shields.io/badge/YouTube-FF0000?style=for-the-badge&logo=youtube&logoColor=white" alt="YouTube"></a>
  <a href="https://skool.com/kenkai"><img src="https://img.shields.io/badge/Skool-Community-7C3AED?style=for-the-badge" alt="Skool"></a>
</p>

Four packages. Each one works on its own. Stack them together and you get a full coding agent — or an orchestrator that drives many of them at once.

| Package | What it does | README |
|---|---|---|
| [`@kleio/ai`](https://www.npmjs.com/package/@kleio/ai) | Unified LLM streaming API across four providers | [packages/gg-ai](packages/gg-ai/README.md) |
| [`@kleio/agent`](https://www.npmjs.com/package/@kleio/agent) | Agent loop with multi-turn tool execution | [packages/gg-agent](packages/gg-agent/README.md) |
| [`@kleio/coder`](https://www.npmjs.com/package/@kleio/coder) | CLI coding agent with OAuth, tools, and TUI | [packages/ggcoder](packages/ggcoder/README.md) |
| [`@kleio/manager`](https://www.npmjs.com/package/@kleio/manager) | Orchestrator that drives many ggcoder workers from one chat | [packages/gg-boss](packages/gg-boss/README.md) |

```
@kleio/ai (standalone)
  └─► @kleio/agent (depends on gg-ai)
        └─► @kleio/coder (depends on both)
              └─► @kleio/manager (orchestrates many ggcoder workers)
```

---

## Which package do I need?

| You want to... | Use |
|---|---|
| Stream LLM responses across providers with one API | [`@kleio/ai`](packages/gg-ai/README.md) |
| Build an agent that calls tools and loops autonomously | [`@kleio/agent`](packages/gg-agent/README.md) |
| Use a ready-made CLI coding agent | [`@kleio/coder`](packages/ggcoder/README.md) |
| Drive many coding agents across multiple projects from one chat | [`@kleio/manager`](packages/gg-boss/README.md) |

Each package works on its own. Install only what you need.

```bash
npm i @kleio/ai          # Just the streaming layer
npm i @kleio/agent       # Streaming + agent loop
npm i -g @kleio/coder     # The full CLI coding agent
npm i -g @kleio/manager     # Multi-project orchestrator
```

---

## For developers

```bash
git clone https://github.com/KenKaiii/gg-framework.git
cd gg-framework
pnpm install
pnpm build
```

TypeScript 5.9 + pnpm workspaces + Ink 6 + React 19 + Vitest 4 + Zod v4

---

## Community

- [YouTube @kenkaidoesai](https://youtube.com/@kenkaidoesai) - tutorials and demos
- [Skool community](https://skool.com/kenkai) - come hang out

---

## License

MIT

---

<p align="center">
  <strong>Less bloat. More coding. Four providers. Four packages. One framework.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@kleio/coder"><img src="https://img.shields.io/badge/Install-npm%20i%20--g%20%40kleio%2Fcoder-blue?style=for-the-badge" alt="Install ggcoder"></a>
  <a href="https://www.npmjs.com/package/@kleio/manager"><img src="https://img.shields.io/badge/Orchestrate-npm%20i%20--g%20%40kleio%2Fmanager-7C3AED?style=for-the-badge" alt="Install gg-boss"></a>
</p>
