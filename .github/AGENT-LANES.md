# Agent lanes — which one to reach for

There are two interactive coding lanes on a maintainer's machine. They bill to
different budgets, so the choice is a spend decision as much as a quality one.

| Lane | Engine | Bills to | Harness |
| --- | --- | --- | --- |
| **Claude lane** | Claude (Opus / Sonnet) | Claude Max subscription | Claude Code, Conductor |
| **OpenCode lane** | Ollama Cloud — `glm-5.2`, `deepseek-v4-flash` | Ollama Cloud subscription | OpenCode CLI/TUI, Conductor |

The two interactive lanes are **flat-rate plans, not metered APIs**. The point of
having both is that they exhaust independently: when the Claude lane hits a
5-hour limit mid-evening, the OpenCode lane is still there.

## Pick the OpenCode / Ollama lane when

- **The Claude lane is rate-limited** and the work can't wait. This is the
  single most common reason.
- **The task is well-specified and mechanical.** Rename a symbol across files,
  add a test for an existing function, write a migration that mirrors one that
  already exists, fix a lint or type error with an obvious fix.
- **The task is bounded and verifiable by a command.** If `pnpm test` or
  `pnpm typecheck` tells you unambiguously whether it worked, a cheaper model is
  fine — the check is the safety net.
- **You want a second opinion** on a diff the Claude lane already produced.
- **It's a bulk read** — summarise a directory, list every caller of a function.
  `glm-5.2` has a 976k context window, which swallows a week of diffs.
- Use `deepseek-v4-flash` for the smallest of these (one-file edits, commit
  messages, quick greps); `glm-5.2` for anything needing judgment.

## Stay on the Claude lane when

- **The work is a design decision.** Architecture, API shape, state management,
  navigation patterns — `CLAUDE.md` says ask rather than assume, and that
  judgment is what you're paying the Claude subscription for.
- **It touches native.** Anything in the blast radius of
  [`native-deps-safety`](../.claude/skills/native-deps-safety/SKILL.md) —
  dependencies, `runtimeVersion`, `native-deps.json`, the lockfile, `expo-*`
  native views, video/GIF. These bugs are invisible to typecheck, tests, and CI,
  so "the tests pass" is not a safety net here.
- **It touches secrets, production, or the Convex deploy path.** See
  [`secrets-and-backends`](../.claude/skills/secrets-and-backends/SKILL.md).
- **It needs orchestration** — spawning subagents, holding a multi-PR plan,
  running Playwright against a live app.
- **It's a code review of someone else's change.** Review is judgment work.
- **The spec is fuzzy** and the first job is to ask the right questions.

## Rules that apply to both lanes

Everything in [`CLAUDE.md`](../CLAUDE.md) applies regardless of engine: never
push to `main`, PR + review before merge, TDD, no scope creep. A cheaper model is
not a licence to skip the review cycle — if anything the review matters more.

The OpenCode lane is configured to load
[`docs/convex-best-practices.md`](../docs/convex-best-practices.md) and the
React-Native-Web rules (headlined by **`Alert.alert` is a no-op on web** — use
`apps/mobile/utils/platformAlert.ts`) into every session, because those two are
the rules a model that has never seen this codebase gets wrong first.

## Machine setup (not in this repo)

The OpenCode lane lives in `~/.config/opencode/` on the maintainer's machine —
it is personal config, not repo config, because the API key is machine-local:

- `opencode.json` — pins a single custom provider `ollama-cloud`
  (`@ai-sdk/openai-compatible` against `https://ollama.com/v1`) and sets
  `enabled_providers: ["ollama-cloud"]`, so there is **no router and no fallback**
  to another vendor. If Ollama Cloud is down, the run fails rather than quietly
  spending somewhere else. The API key is `{env:OLLAMA_API_KEY}` — never a
  literal.
- `env.sh` — exports `OLLAMA_API_KEY` from the macOS keychain. Source it
  (`. ~/.config/opencode/env.sh`) before running `opencode`; add that line to
  `~/.zshrc` to make it stick. GUI harnesses like Conductor do not read
  `~/.zshrc`, so they need the key in the GUI environment
  (`launchctl setenv OLLAMA_API_KEY …`) or a credential stored via
  `opencode providers login`.
- `AGENTS.md` + `rules/rn-web.md` — the always-loaded rules described above.
