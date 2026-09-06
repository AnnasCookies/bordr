/**
 * Each harness's own slash commands, as its `/` popup listed them on
 * 2026-09-07 (claude 2.1.263, codex, pi, omp, agy, grok, copilot 1.0.83),
 * descriptions verbatim. Skills, prompts and plugins the person installed
 * are not here: commands.ts reads those off disk so the list matches what
 * the harness shows on this machine.
 */
export const BUILTIN_COMMANDS: Record<
	string,
	ReadonlyArray<readonly [name: string, description: string]>
> = {
	claude: [
		['add-dir', 'Add a new working directory'],
		['advisor', 'Let Claude consult a stronger model at key moments'],
		['agents', '(removed) Ask Claude to create/manage subagents, or edit .claude/agents/'],
		[
			'artifact-diagramming',
			'Diagramming know-how for Artifacts - when a picture earns its place, how to draw one that shows the real mechanism, and the inline-SVG mechanics that keep it legible in both themes.'
		],
		['auto-mode-setup', 'Teach auto mode about your environment, plus optional rule tweaks'],
		['autocompact', 'Set how full the context gets before auto-summarizing'],
		['autofix-pr', 'Monitor and autofix any issues with the current PR'],
		[
			'batch',
			'Research and plan a large-scale change, then execute it in parallel across 5–30 isolated worktree agents that each open a PR.'
		],
		['btw', 'Ask a quick side question without interrupting the main conversation'],
		['bug', 'Report a bug or share your conversation'],
		['cd', 'Move this session to a new working directory'],
		['chrome', 'Open Claude in Chrome settings'],
		[
			'claude-api',
			"Reference for the Claude API / Anthropic SDK — model ids, pricing, params, streaming, tool use, MCP, agents, caching, token counting, model migration. TRIGGER — read BEFORE opening the target file; don't skip because it"
		],
		[
			'claude-in-chrome',
			'Automates your Chrome browser to interact with web pages - clicking elements, filling forms, capturing screenshots, reading console logs, and navigating sites. Opens pages in new tabs within your existing Chrome session.'
		],
		[
			'clear',
			'Start a new session with empty context; previous session stays on disk (resumable with /resume)'
		],
		[
			'code-review',
			'Review the current diff, or a PR number/branch/path target, for correctness bugs and reuse/simplification/efficiency cleanups at the given effort level (low/medium: fewer, high-confidence findings;'
		],
		['color', 'Set the prompt bar color for this session'],
		['compact', 'Free up context by summarizing the conversation so far'],
		['context', 'Visualize current context usage as a colored grid'],
		['copy', "Copy Claude's last response to clipboard (or /copy N for the Nth-latest)"],
		[
			'dataviz',
			'Use this skill whenever you are about to create ANY chart, graph, plot, dashboard, or data visualization, in ANY output medium — an HTML or React artifact, inline SVG, plotting code in any library (matplotlib, plotly, d3,'
		],
		['debug', 'Enable debug logging for this session and help diagnose issues'],
		[
			'design',
			"Create a design canvas - a multi-artboard visual design published as an Artifact that runs Claude Design's canvas editor (an early preview of Claude Design inside Claude Code). You DRAFT the design as .dc.html artboards"
		],
		['design-login', 'Authorize design-system access for /design-sync with your claude.ai account'],
		[
			'design-sync',
			'Push a React design system to claude.ai/design. This runs a converter that bundles the real component code (from Storybook or a bare package) and uploads it. Use when the user runs /design-sync or says "sync my design'
		],
		['diff', 'Toggle the diff panel showing uncommitted changes'],
		[
			'doctor',
			"Health-check the user's Claude Code setup and fix issues: diagnose installation health — what the `claude doctor` terminal diagnostics cover — from local data (duplicate or leftover installs, PATH, unparseable settings"
		],
		['effort', 'Set effort level for model usage'],
		['exit', 'Exit the CLI'],
		['export', 'Export the current conversation to a file or clipboard'],
		['fast', 'Toggle fast mode (Opus 5)'],
		['feedback', 'Send feedback to Anthropic or report a bug'],
		[
			'fewer-permission-prompts',
			'Scan your transcripts for common read-only Bash and MCP tool calls, then add a prioritized allowlist to project .claude/settings.json to reduce permission prompts.'
		],
		['focus', 'Toggle focus view: just your prompt, summary, and response'],
		['fork', 'Copy this conversation into a new background session and keep working here'],
		['goal', 'Set a goal Claude checks before stopping'],
		['help', 'Show help and available commands'],
		['hooks', 'View hook configurations for tool events'],
		['ide', 'Manage IDE integrations and show status'],
		['import', 'Import config from another AI coding agent'],
		['init', 'Initialize a new CLAUDE.md file with codebase documentation'],
		['insights', 'Generate a report analyzing your Claude Code sessions'],
		['install-github-app', 'Set up Claude GitHub Actions for a repository'],
		['install-slack-app', 'Install the Claude Slack app'],
		['keybindings', 'Open your keyboard shortcuts file'],
		['list-agents', 'List subagents, teammates, and other Claude sessions you can message'],
		['login', 'Sign in with your Anthropic account'],
		['logout', 'Sign out from your Anthropic account'],
		[
			'loop',
			'Run a prompt or slash command on a recurring interval (e.g. /loop 5m /foo). Omit the interval to let the model self-pace.'
		],
		['mcp', 'Manage MCP servers'],
		['memory', 'Edit CLAUDE.md files and memory settings'],
		['mobile', 'Show QR code to download the Claude mobile app'],
		['model', 'Set the AI model for Claude Code'],
		['permissions', 'Manage allow and deny tool permission rules'],
		['plan', 'Enable plan mode or view the current session plan'],
		['powerup', 'Discover Claude Code features through quick interactive lessons'],
		['radio', 'Listen to Claude FM lo-fi radio'],
		['recap', 'Generate a one-line session recap now'],
		['reload-plugins', 'Activate pending plugin changes in the current session'],
		['rename', 'Rename the current conversation'],
		['resume', 'Resume a previous conversation'],
		[
			'run',
			"Launch and drive this project's app to see a change working. Use when asked to run, start, or screenshot the app, or to confirm a change works in the real app (not just tests). First looks for a project skill that already"
		],
		['sandbox', 'Configure the sandbox'],
		[
			'schedule',
			'Create, update, list, or run scheduled cloud agents (routines) that execute on a cron schedule.'
		],
		['scroll-speed', 'Adjust mouse wheel scroll speed'],
		['security-review', 'Complete a security review of the pending changes on the current branch'],
		['skill-doctor', 'Show which loaded skills are unused and costing context'],
		['skills', 'List available skills'],
		[
			'status',
			'Show Claude Code status including version, model, account, API connectivity, and tool statuses'
		],
		['stickers', 'Order Claude Code stickers'],
		['subtask', 'Send a subagent off with your full context; its result comes back here'],
		['tasks', 'View and manage everything running in the background'],
		['team-onboarding', 'Help teammates ramp on Claude Code with a guide from your usage'],
		['terminal-setup', 'Install Shift+Enter key binding for newlines'],
		['theme', 'Change the theme'],
		['tui', 'Set the terminal UI renderer (default | fullscreen)'],
		[
			'ultrareview',
			'Start a cloud agent that finds and verifies bugs in your branch (~5-10 min, $5-$25 USD) · Runs in Claude Code on the web. See https://code.claude.com/docs/en/claude-code-on-the-web'
		],
		[
			'update-config',
			'Use this skill to configure the Claude Code harness via settings.json. Automated behaviors ("from now on when X", "each time X", "whenever X", "before/after X") require hooks configured in settings.json - the harness'
		],
		['upgrade', 'Upgrade to Max for higher rate limits and more Opus'],
		['usage', 'Show session cost, plan usage, and activity stats'],
		[
			'verify',
			"Verify that a code change actually does what it's supposed to by exercising it end-to-end and observing behavior — drive the affected flow, not just tests or typecheck. Run before committing nontrivial changes; bootstraps"
		],
		['voice', 'Toggle voice mode'],
		['web-setup', 'Set up Claude Code on the web with your GitHub account'],
		[
			'workflow-authoring',
			'Reference for writing a Workflow tool script (script API and gotchas, resume, quality patterns, worked examples). Load before authoring a script for a workflow the user already opted into; it does not itself authorize'
		],
		['workflows', 'Browse running and completed workflows']
	],
	codex: [
		['agents', 'view and switch between all active agent sessions'],
		['approve', 'approve one retry of a recent auto-review denial'],
		['archive', 'archive this session and exit'],
		['btw', 'start a side conversation in an ephemeral fork'],
		['cd', 'change the current working directory'],
		['clear', 'clear the terminal and start a new chat'],
		['compact', 'summarize conversation to prevent hitting the context limit'],
		['copy', 'copy the last response, code block, or quote'],
		['delete', 'permanently delete this session and exit'],
		['diff', 'show git diff (including untracked files)'],
		['exit', 'exit Codex'],
		['experimental', 'toggle experimental features'],
		['export', 'export the conversation as markdown'],
		['fast', '2x speed, increased usage'],
		['feedback', 'send logs to maintainers'],
		['fork', 'fork the current chat'],
		['goal', 'set or view the goal for a long-running task'],
		['hooks', 'view and manage lifecycle hooks'],
		['ide', 'include current selection, open files, and other context from your IDE'],
		['import', 'import setup, this project, and recent chats from Claude Code'],
		['init', 'create an AGENTS.md file with instructions for Codex'],
		['keymap', 'remap TUI shortcuts'],
		['logout', 'log out of Codex'],
		['mcp', 'list configured MCP tools; use /mcp verbose for details'],
		['memories', 'configure memory use and generation'],
		['mention', 'mention a file'],
		['model', 'choose what model and reasoning effort to use'],
		['new', 'start a new chat during a conversation'],
		['permissions', 'choose what Codex is allowed to do'],
		['personality', 'choose a communication style for Codex'],
		['pets', 'choose or hide the terminal pet'],
		['plan', 'switch to Plan mode'],
		['plugins', 'browse plugins'],
		['ps', 'list background terminals'],
		['pwd', 'show the current working directory'],
		['quit', 'exit Codex'],
		['raw', 'toggle raw scrollback mode for copy-friendly terminal selection'],
		['recap', 'summarize the current conversation now'],
		['rename', 'rename the current thread'],
		['resume', 'resume a saved chat'],
		['review', 'review my current changes and find issues'],
		['side', 'start a side conversation in an ephemeral fork'],
		['skills', 'use skills to improve how Codex performs specific tasks'],
		['status', 'show current session configuration and token usage'],
		['statusline', 'configure which items appear in the status line'],
		['stop', 'stop all background terminals'],
		['subagents', "switch between this session's subagents"],
		['theme', 'choose a syntax highlighting theme'],
		['title', 'configure which items appear in the terminal title'],
		['usage', 'view account usage or use a usage limit reset'],
		['vim', 'toggle Vim mode for the composer']
	],
	pi: [
		['settings', 'Open settings menu'],
		['model', '<provider/model> — Select model (opens selector UI)'],
		['tree', 'Navigate session tree (switch branches)'],
		['thinking', '<level> — Set thinking level'],
		['scoped-models', 'Enable/disable models for Ctrl+P cycling'],
		['export', 'Export session (HTML default, or specify path: .html/.jsonl)'],
		['import', 'Import and resume a session from a JSONL file'],
		['share', 'Share session as a secret GitHub gist'],
		['copy', 'Copy last agent message to clipboard'],
		['name', 'Set session display name'],
		['session', 'Show session info and stats'],
		['changelog', 'Show changelog entries'],
		['hotkeys', 'Show all keyboard shortcuts'],
		['fork', 'Create a new fork from a previous user message'],
		['clone', 'Duplicate the current session at the current position'],
		['trust', 'Save project trust decision for future sessions'],
		['login', '<provider> — Configure provider authentication'],
		['logout', 'Remove provider authentication'],
		['new', 'Start a new session'],
		['compact', 'Manually compact the session context'],
		['resume', 'Resume a different session'],
		['reload', 'Reload keybindings, extensions, skills, prompts, themes, and context files'],
		['quit', 'Quit pi'],
		['llama', '[t] Manage llama.cpp router models']
	],
	omp: [
		['settings', 'Open settings menu'],
		['model', '<provider/model> — Select model (opens selector UI)'],
		['tree', 'Navigate session tree (switch branches)'],
		['thinking', '<level> — Set thinking level'],
		['scoped-models', 'Enable/disable models for Ctrl+P cycling'],
		['export', 'Export session (HTML default, or specify path: .html/.jsonl)'],
		['import', 'Import and resume a session from a JSONL file'],
		['share', 'Share session as a secret GitHub gist'],
		['copy', 'Copy last agent message to clipboard'],
		['name', 'Set session display name'],
		['session', 'Show session info and stats'],
		['changelog', 'Show changelog entries'],
		['hotkeys', 'Show all keyboard shortcuts'],
		['fork', 'Create a new fork from a previous user message'],
		['clone', 'Duplicate the current session at the current position'],
		['trust', 'Save project trust decision for future sessions'],
		['login', '<provider> — Configure provider authentication'],
		['logout', 'Remove provider authentication'],
		['new', 'Start a new session'],
		['compact', 'Manually compact the session context'],
		['resume', 'Resume a different session'],
		['reload', 'Reload keybindings, extensions, skills, prompts, themes, and context files'],
		['quit', 'Quit pi'],
		['switch', 'Switch model (opens the model browser)'],
		['vibe', 'Toggle vibe mode'],
		['loop', 'Toggle loop mode'],
		['prewalk', 'Switch to a fast/cheap model at the next action'],
		['open', 'Open the last link from the conversation in your browser'],
		['autoresearch', 'Toggle builtin autoresearch mode, or pass a goal'],
		['doctor', 'Check the installation and configuration'],
		['update', 'Update omp']
	],
	agy: [
		['add-dir', 'Add a directory to the workspace'],
		['agents', 'List available custom agents'],
		[
			'agy-customizations',
			'Comprehensive guide and reference for the Antigravity Customization System. Use to explain how customizations work, their loading priority, discovery mechanisms, and to guide the creation of skills, rules, plugins, hooks, and MCP servers.'
		],
		[
			'antigravity-guide',
			'Provides a comprehensive guide, quick reference, and sitemap for Google Antigravity (AGY), including the Antigravity CLI (agy), Antigravity 2.0, Antigravity IDE, Python SDK, slash commands, keybindings, and customizations (skills, rules, MCP, sidecars). Activate...'
		],
		['artifact', 'View and review artifacts'],
		['boost', 'Invoke the Boost multi-agent orchestrator for complex tasks.'],
		['browser', 'Invoke a browser agent for web tasks.'],
		['btw', 'Ask a side question without interrupting the current task'],
		['changelog', 'Show release notes and changes'],
		['clear', 'Clear conversation and start a new one'],
		['codesearch', 'Search code in the workspace (usage: /codesearch <query>)'],
		['config', 'Open settings panel'],
		['context', 'Visualize current context usage'],
		[
			'copy',
			"Copy the last planner response to the clipboard, or the n-th most recent with '/copy n' (may require allowing clipboard access in your terminal)"
		],
		['credits', 'Show remaining G1 credits and purchase link'],
		['diff', 'View uncommitted changes and per-turn diffs'],
		['effort', 'Set the reasoning effort'],
		['exit', 'Exit the CLI'],
		['feedback', 'Submit qualitative feedback to improve the agent'],
		[
			'fork',
			'Create a branch of the current conversation at this point, optionally specifying a project ID to fork into'
		],
		[
			'generative_ui',
			'How to render rich interactive HTML widgets inline in the chat or as standalone artifacts. Use this skill when you want to show the user diagrams, data visualizations, interactive controls, educational walkthroughs, or any rich visual content beyond plain text ...'
		],
		['goal', 'Run until the specified goal is completely finished.'],
		['grill-me', 'Interview me to align on a plan.'],
		['help', 'Show available commands and keybindings'],
		['hooks', 'Manage hook configurations for tool events'],
		['keybindings', 'Set custom keybindings'],
		['learn', 'Reflect on recent successes or corrections to capture reusable skills or rules.'],
		['logout', 'Log out'],
		['mcp', 'Manage MCP servers'],
		[
			'migrate-workflows',
			'Automatically migrate legacy workflows to modern skills across global and workspace configurations. Scans for existing workflows, creates target SKILL.md files, and safely archives old workflow files.'
		],
		['model', 'Set a model, or run a single prompt on another model'],
		['open', 'Open a file or view opened/edited files'],
		[
			'permissioned-github',
			'Guidelines for interacting with GitHub and request permissions from the user when commands fail due to restrictions in the agent environment.'
		],
		['permissions', 'Manage tool permissions'],
		['plan', 'Plan carefully before executing a task.'],
		['rename', 'Rename the current conversation'],
		['resume', 'Browse and resume past conversations'],
		['rewind', 'Rewind conversation to a previous message'],
		['schedule', 'Run an instruction on a recurring schedule or as a one-time timer.'],
		['skills', 'List available skills'],
		['statusline', 'Toggle the statusline'],
		['tasks', 'View background tasks'],
		['teamwork-preview', 'Invoke a team of agents to autonomously tackle large projects.'],
		['title', 'Toggle custom terminal window title'],
		['usage', 'View model quota usage'],
		['voice', 'Dictate a prompt using your microphone']
	],
	grok: [
		['agents', 'Manage agent definitions'],
		['agents-dashboard', 'Open the Agent Dashboard'],
		['always-approve', 'Toggle always-approve mode (skip all permission prompts)'],
		['announcements', 'Show or hide announcements'],
		['auto', 'Toggle auto mode (classifier approves safe tools)'],
		['btw', 'Ask a side question without interrupting'],
		['build-with-ai', 'Build AI apps on SpaceXAI (XAI_API_KEY + api.x.ai)'],
		['changelog', 'View release notes for the current version'],
		['clear', 'Start a new session'],
		['compact', 'Compact conversation history'],
		['compact-mode', 'Toggle compact UI (less padding, more content)'],
		['config', 'Open the settings modal'],
		['config-agents', 'Manage agent definitions'],
		['context', 'View context usage'],
		['copy', 'Copy last response to clipboard or file (/copy [N] [file])'],
		['cost', 'View usage'],
		['create-skill', 'Create a new Grok skill'],
		['create-workflow', 'Author a new multi-agent workflow'],
		['dashboard', 'Open the Agent Dashboard'],
		[
			'deep-research',
			'Research with bounded parallel agents, cross-check evidence, and write a cited report'
		],
		['delete', 'Delete this session'],
		['docs', 'Open How-to Guides or online Build docs'],
		['doctor', 'Check this session and show available fixes'],
		['dream', 'Run memory consolidation (merge session logs into organized topics)'],
		[
			'edit-prompt',
			'Open an external editor for an empty prompt; use the command palette to preserve a draft'
		],
		['effort', 'Set reasoning effort for the current model'],
		[
			'execute-plan',
			'Execute a PR Plan DAG from a design document. Parses the plan, topologically sorts it, implements PRs in parallel using worktree-isolated subagents, runs mandatory orchestrator-level review, and assembles either a Graphite PR stack or a'
		],
		['exit', 'Quit the application'],
		['export', 'Export the current conversation to a file or clipboard'],
		['feedback', 'Send feedback about the current session'],
		['find', 'Search the conversation scrollback'],
		['flush', 'Flush conversation memory to disk now'],
		['fork', 'Branch the current session into a peer agent'],
		['goal', 'Set, manage, or check an autonomous goal'],
		['guides', 'Open How-to Guides or online Build docs'],
		['history', 'Search prompt history'],
		['home', 'Return to the welcome screen'],
		['hooks', 'View hooks'],
		['howto', 'Open How-to Guides or online Build docs'],
		['imagine', 'Generate an image from a text description built-in'],
		['imagine-video', 'Generate a video from a text description'],
		['import-claude', 'Open the Claude settings import modal'],
		['jump', 'Jump to a turn in the conversation'],
		['log', 'View the conversation transcript in your pager ($PAGER)'],
		['login', 'Log in or re-authenticate with your account'],
		['logout', 'Log out and return to the login screen'],
		[
			'long-running-background-tasks',
			'Required reading before you start, watch, or wait on anything that keeps running after you launch it — background jobs, watchers, scheduled loops, CI, pull requests, training runs, dev servers, long builds. Read it before you launch such'
		],
		['loop', 'Run a prompt on a recurring interval'],
		['mcps', 'Show MCP server status'],
		['minimal', 'Switch this session to minimal (scrollback-native) mode, back with /fullscreen'],
		['model', 'Switch the active model'],
		['multiline', 'Toggle multiline input mode (swap Enter and Shift+Enter)'],
		['new', 'Start a new session'],
		['onboarding', 'Quick tips to get the most out of Grok Build'],
		['personas', 'Manage personas (create, edit, delete)'],
		['plan', 'Enter plan mode'],
		['plan-view', 'View the current plan'],
		['plugins', 'View plugins'],
		[
			'pr-babysit',
			'Monitor PRs, fix CI failures, address review comments, resolve merge conflicts, and restack stacks. Supports independent PRs, Graphite stacks, and GitHub stacked PRs (gh-stack).'
		],
		['preferences', 'Open the settings modal'],
		['privacy', 'Open coding data, retention, and training settings'],
		['queue', 'List the prompts queued behind the running turn'],
		['quit', 'Quit the application'],
		['recap', 'Summarize the session so far'],
		['release-notes', 'View release notes for the current version'],
		['remember', 'Save a memory note'],
		['rename', 'Rename the current session'],
		['resume', 'Resume a previous session'],
		['resume-claude', 'Continue from a recent Claude Code session'],
		['resume-codex', 'Continue from a recent Codex session'],
		['resume-cursor', 'Continue from a recent Cursor session'],
		['rewind', 'Rewind to a previous turn'],
		['session-info', 'Show session info'],
		['sessions', 'Open the Agent Dashboard'],
		['settings', 'Open the settings modal'],
		['show-plan', 'View the current plan'],
		[
			'skill-design-principles',
			'Concise, high-signal principles for writing and editing skills well. Use whenever authoring or editing a skill.'
		],
		['summarize', 'Summarize the session so far'],
		['tasks', 'List background tasks, subagents, and scheduled tasks'],
		['terminal-check', 'Check this session and show available fixes'],
		['terminal-info', 'Check this session and show available fixes'],
		['theme', 'Switch the color theme'],
		['timeline', 'Toggle the timeline sidebar'],
		['timestamps', 'Toggle message timestamps on/off'],
		['title', 'Rename the current session'],
		[
			'to-questionnaire',
			"Turn a decision you can't fully answer into a questionnaire for someone else to fill in."
		],
		['transcript', 'View the conversation transcript in your pager ($PAGER)'],
		['tutorial', 'Quick tips to get the most out of Grok Build'],
		['undo', 'Rewind to a previous turn'],
		['usage', 'View usage'],
		['view-plan', 'View the current plan'],
		['vim-mode', 'Toggle vim-style scrollback keybindings (j/k, h/l, g/G, y/Y, …)'],
		['voice', 'Dictation (Ctrl+Space/F8; Esc/Enter to stop)'],
		['wait-what', 'Stop. That last message did not land: re-pitch it.'],
		['welcome', 'Return to the welcome screen'],
		['workflows', 'Browse installed workflows'],
		[
			'writing-for-agents',
			'Writing documents for agents. Use when creating or editing skills, or modifying AGENTS.md or CLAUDE.md.'
		]
	],
	copilot: [
		[
			'add-dir',
			'Allow file access to a directory and load its .github skills and agents as trusted configuration'
		],
		['agent', 'Browse and select agents: /agent [name]'],
		['allow-all', 'Enable all permissions (tools, paths, and URLs)'],
		['app', 'Prefer a visual workspace? Try out the GitHub Copilot desktop app'],
		['ask', 'Ask a quick side question without adding to conversation history'],
		[
			'autopilot',
			'Toggle autopilot mode, or set an autopilot objective with an optional AI-credit limit (--max-ai-credits)'
		],
		['help', 'Show help'],
		['model', 'Select the AI model for this session'],
		['config', 'Open settings'],
		['clear', 'Clear the conversation'],
		['compact', 'Compact the conversation'],
		['exit', 'Exit the CLI']
	]
};
