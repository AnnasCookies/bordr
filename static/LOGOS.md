# Harness marks

Baked into `src/lib/harness-logos.ts` by `scripts/build-harness-logos.ts`
from [simple-icons](https://simpleicons.org) (icon data CC0-1.0).

Each mark remains the trademark of its owner and is used here only to identify
that tool inside bordr. No endorsement is implied.

| agent | mark | source |
| --- | --- | --- |
| claude | Claude | https://claude.ai |
| gemini | Google Gemini | https://gemini.google.com |
| copilot | GitHub Copilot | https://primer.style/foundations/icons/copilot-24 |
| cursor | Cursor | https://cursor.com/brand |
| opencode | OpenCode | https://github.com/anomalyco/opencode/blob/1251a870cb384543c150c4a72fb101b55eec971b/packages/identity/mark.svg |
| qwen | QWen | https://qwen.ai |
| kimi | Kimi | https://moonshotai.github.io/Branding-Guide |
| cline | Cline | https://cline.bot/assets/branding/logos/cline-wordmark-black.svg |

simple-icons carries no OpenAI or xAI icon — both were removed at the owners'
request — and its "Pi", "AMP" and "Hermes" are different products entirely.

## Converted by hand

In `src/lib/harness-marks.ts`, flattened to one colour and fitted to the
24-unit box. Each stays its project's mark.

| agent | mark | source |
| --- | --- | --- |
| pi | pi | https://pi.dev/logo-auto.svg |
| omp | oh-my-pi | https://github.com/can1357/oh-my-pi/blob/master/assets/icon.svg |
| codex | OpenAI | https://github.com/openai/openai-assistants-quickstart/blob/main/public/openai.svg |
| grok | Grok (xAI) | https://grok.com/images/favicon.svg (the glyph inside it, without the tile and filters) |
| agy | Google Antigravity | https://antigravity.google (the wordmark inlined in the page; the standalone logo they publish is a PNG) |

OpenAI's mark is the one simple-icons removed at their request, so it is taken
from OpenAI's own repository instead and kept in its 32-unit box. It identifies
Codex inside bordr and nothing else; it remains OpenAI's trademark.

Every other agent falls back to a Nerd Font glyph, scaled to sit at the same
weight as the marks beside it.

## The collie

`collie-hero.png`, `collie-badge.png`, `collie.svg`, the `patrl-*.png` icons
and the README banner (`.github/media/banner.jpg`)
were generated with ChatGPT from the maintainer's own brief for this project,
and ship with it under the MIT licence.
