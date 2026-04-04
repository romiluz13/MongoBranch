<!DOCTYPE html>

<html class="dark" lang="en"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>MongoBranch | Git-level Versioning for MongoDB</title>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700;800&amp;family=Inter:wght@400;500&amp;family=Space+Grotesk:wght@400;500;600;700&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<script id="tailwind-config">
        tailwind.config = {
          darkMode: "class",
          theme: {
            extend: {
              "colors": {
                      "on-primary-container": "#00531e",
                      "error-container": "#b92902",
                      "surface-container-highest": "#122a27",
                      "on-surface": "#d7e9e5",
                      "secondary-container": "#096c4d",
                      "surface-container-lowest": "#000000",
                      "primary-dim": "#06ee65",
                      "surface-dim": "#02110f",
                      "tertiary-fixed": "#72f3a2",
                      "primary-container": "#14f167",
                      "on-primary-fixed-variant": "#006627",
                      "on-primary-fixed": "#004618",
                      "tertiary-container": "#72f3a2",
                      "surface-container-low": "#051614",
                      "on-error-container": "#ffd2c8",
                      "on-tertiary": "#006235",
                      "tertiary": "#8fffb5",
                      "secondary-dim": "#92e5bf",
                      "surface-bright": "#17302d",
                      "secondary-fixed": "#9ff4cd",
                      "background": "#02110f",
                      "surface-tint": "#46ff78",
                      "inverse-on-surface": "#485856",
                      "tertiary-fixed-dim": "#63e495",
                      "tertiary-dim": "#63e495",
                      "primary-fixed": "#31fd71",
                      "on-error": "#450900",
                      "surface-container": "#091d1a",
                      "surface": "#02110f",
                      "on-surface-variant": "#9dafab",
                      "primary": "#46ff78",
                      "on-background": "#d7e9e5",
                      "on-secondary-fixed": "#004933",
                      "on-tertiary-container": "#005930",
                      "secondary-fixed-dim": "#92e5bf",
                      "primary-fixed-dim": "#06ee65",
                      "on-secondary-container": "#e0ffed",
                      "error": "#ff7351",
                      "secondary": "#9ff4cd",
                      "on-secondary": "#005e42",
                      "outline": "#687976",
                      "surface-container-high": "#0d2320",
                      "error-dim": "#d53d18",
                      "surface-variant": "#122a27",
                      "on-primary": "#005d23",
                      "on-tertiary-fixed": "#004423",
                      "on-tertiary-fixed-variant": "#006436",
                      "outline-variant": "#3b4b48",
                      "inverse-surface": "#ebfdf9",
                      "inverse-primary": "#006e2a",
                      "on-secondary-fixed-variant": "#02694b"
              },
              "borderRadius": {
                      "DEFAULT": "0.125rem",
                      "lg": "0.25rem",
                      "xl": "0.5rem",
                      "full": "0.75rem"
              },
              "fontFamily": {
                      "headline": ["Manrope"],
                      "body": ["Inter"],
                      "label": ["Space Grotesk"]
              }
            },
          },
        }
      </script>
<style>
        .material-symbols-outlined {
            font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
        }
        body { font-family: 'Inter', sans-serif; }
        h1, h2, h3, h4 { font-family: 'Manrope', sans-serif; }
        .mono { font-family: 'Space Grotesk', monospace; }
        .glass-panel {
            background: rgba(18, 42, 39, 0.4);
            backdrop-filter: blur(12px);
            border: 1px solid rgba(147, 255, 120, 0.05);
        }
        .gradient-text {
            background: linear-gradient(135deg, #46ff78 0%, #14f167 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .hero-glow {
            background: radial-gradient(circle at 50% 50%, rgba(70, 255, 120, 0.08) 0%, rgba(2, 17, 15, 0) 70%);
        }
    </style>
</head>
<body class="bg-background text-on-background selection:bg-primary selection:text-on-primary">
<!-- Top Navigation Shell -->
<nav class="bg-[#02110f]/80 backdrop-blur-xl docked full-width top-0 sticky z-50">
<div class="flex justify-between items-center w-full px-6 py-4 max-w-7xl mx-auto">
<div class="text-xl font-bold tracking-tighter text-[#46ff78] flex items-center gap-2">
<span class="material-symbols-outlined" data-icon="account_tree">account_tree</span>
                MongoBranch
            </div>
<div class="hidden md:flex gap-8 items-center">
<a class="text-[#46ff78] font-bold transition-colors duration-200" href="#">Quick Start</a>
<a class="text-[#9dafab] font-medium hover:text-[#46ff78] transition-colors duration-200" href="#">Features</a>
<a class="text-[#9dafab] font-medium hover:text-[#46ff78] transition-colors duration-200" href="#">MCP Server</a>
<a class="text-[#9dafab] font-medium hover:text-[#46ff78] transition-colors duration-200" href="#">CLI</a>
<a class="text-[#9dafab] font-medium hover:text-[#46ff78] transition-colors duration-200" href="#">GitHub</a>
</div>
<button class="bg-gradient-to-r from-primary to-primary-container text-on-primary px-5 py-2 font-bold rounded-lg hover:scale-95 transition-transform">
                Star on GitHub
            </button>
</div>
</nav>
<!-- Hero Section -->
<section class="relative pt-24 pb-32 overflow-hidden">
<div class="absolute inset-0 hero-glow"></div>
<div class="max-w-7xl mx-auto px-6 relative z-10 text-center">
<span class="mono text-primary text-sm font-semibold tracking-widest uppercase mb-4 block">v1.2.0 is live</span>
<h1 class="text-6xl md:text-8xl font-extrabold tracking-tight mb-6 leading-none">
                MongoBranch
            </h1>
<p class="text-xl md:text-2xl text-on-surface-variant max-w-3xl mx-auto font-medium mb-10 leading-relaxed">
                Git-level version control for <span class="text-on-surface font-bold">MongoDB</span> — built for <span class="text-primary italic">AI agents</span>.
            </p>
<div class="flex flex-col md:flex-row justify-center gap-4 mb-20">
<button class="bg-gradient-to-r from-primary to-primary-container text-on-primary px-8 py-4 font-bold text-lg rounded-xl hover:shadow-[0_0_20px_rgba(70,255,120,0.3)] transition-all flex items-center justify-center gap-2">
<span class="material-symbols-outlined" data-icon="rocket_launch">rocket_launch</span>
                    Quick Start
                </button>
<button class="bg-surface-container-highest border border-outline-variant/30 text-on-surface px-8 py-4 font-bold text-lg rounded-xl hover:bg-surface-container transition-all flex items-center justify-center gap-2">
<span class="material-symbols-outlined" data-icon="star">star</span>
                    Star on GitHub
                </button>
</div>
<!-- Terminal Visual -->
<div class="glass-panel p-8 rounded-2xl max-w-5xl mx-auto shadow-2xl relative">
<div class="flex items-center gap-2 mb-6">
<div class="w-3 h-3 rounded-full bg-error-dim"></div>
<div class="w-3 h-3 rounded-full bg-secondary"></div>
<div class="w-3 h-3 rounded-full bg-primary"></div>
<div class="ml-4 mono text-xs text-on-surface-variant opacity-50">mongo-branch viz --graph</div>
</div>
<div class="flex items-center justify-center py-12 relative overflow-hidden">
<!-- Branch Graphic -->
<div class="flex items-center gap-0 w-full max-w-3xl">
<div class="relative group">
<div class="w-4 h-4 rounded-full bg-primary ring-4 ring-primary/20"></div>
<div class="absolute -top-8 left-1/2 -translate-x-1/2 mono text-[10px] text-primary">main</div>
</div>
<div class="h-1 flex-1 bg-gradient-to-r from-primary to-secondary"></div>
<div class="relative">
<div class="w-4 h-4 rounded-full bg-secondary"></div>
<div class="absolute h-24 w-1 bg-secondary left-1/2 -translate-x-1/2 top-4"></div>
<div class="absolute -top-8 left-1/2 -translate-x-1/2 mono text-[10px] text-secondary">feat/ai-refactor</div>
</div>
<div class="h-1 flex-1 bg-outline-variant opacity-20"></div>
<div class="w-4 h-4 rounded-full border-2 border-outline-variant opacity-50"></div>
<div class="h-1 flex-1 bg-outline-variant opacity-20"></div>
<div class="relative">
<div class="w-4 h-4 rounded-full bg-primary animate-pulse"></div>
<div class="absolute -top-8 left-1/2 -translate-x-1/2 mono text-[10px] text-primary">MERGING...</div>
</div>
</div>
</div>
<div class="grid grid-cols-2 gap-4 mt-8">
<div class="bg-surface-container-low p-4 rounded-lg text-left mono text-xs text-[#9dafab]">
<span class="text-primary">+ 48,230 documents indexed</span><br/>
<span class="text-primary">+ created branch: test-agent-run-01</span>
</div>
<div class="bg-surface-container-low p-4 rounded-lg text-left mono text-xs text-[#9dafab]">
<span class="text-error">- dropped collection: old_v1_backup</span><br/>
<span class="text-secondary"># commit 4f2a9b - agent state saved</span>
</div>
</div>
</div>
</div>
</section>
<!-- Problem/Solution Section -->
<section class="py-24 bg-surface-container-low">
<div class="max-w-7xl mx-auto px-6">
<div class="grid md:grid-cols-2 gap-12">
<!-- Problem -->
<div class="glass-panel p-10 rounded-2xl border-error/10">
<div class="w-12 h-12 bg-error/10 rounded-full flex items-center justify-center mb-6">
<span class="material-symbols-outlined text-error" data-icon="report">report</span>
</div>
<h3 class="text-2xl font-bold mb-4">Without MongoBranch</h3>
<p class="text-on-surface-variant mb-8">Production environments are fragile. One rogue agent loop or experimental script can corrupt millions of records.</p>
<ul class="space-y-4">
<li class="flex items-center gap-3 text-on-surface-variant/70">
<span class="material-symbols-outlined text-error-dim" data-icon="cancel">cancel</span>
                            "Hope the agent doesn't break anything"
                        </li>
<li class="flex items-center gap-3 text-on-surface-variant/70">
<span class="material-symbols-outlined text-error-dim" data-icon="cancel">cancel</span>
                            Expensive full-database backups
                        </li>
<li class="flex items-center gap-3 text-on-surface-variant/70">
<span class="material-symbols-outlined text-error-dim" data-icon="cancel">cancel</span>
                            Hours of downtime for data recovery
                        </li>
</ul>
</div>
<!-- Solution -->
<div class="glass-panel p-10 rounded-2xl border-primary/20 bg-surface-container-high shadow-[0_0_40px_rgba(70,255,120,0.05)]">
<div class="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-6">
<span class="material-symbols-outlined text-primary" data-icon="check_circle">check_circle</span>
</div>
<h3 class="text-2xl font-bold mb-4">With MongoBranch</h3>
<p class="text-on-surface-variant mb-8">Deploy agents into zero-cost isolated branches. Every change is a commit, every error is a roll-back.</p>
<ul class="space-y-4">
<li class="flex items-center gap-3 text-primary">
<span class="material-symbols-outlined" data-icon="verified">verified</span>
                            Isolated branch copies in milliseconds
                        </li>
<li class="flex items-center gap-3 text-primary">
<span class="material-symbols-outlined" data-icon="verified">verified</span>
                            Zero-copy clones using engine snapshots
                        </li>
<li class="flex items-center gap-3 text-primary">
<span class="material-symbols-outlined" data-icon="verified">verified</span>
                            Merge diffs back to main after approval
                        </li>
</ul>
</div>
</div>
</div>
</section>
<!-- Feature Matrix -->
<section class="py-24">
<div class="max-w-7xl mx-auto px-6">
<div class="text-center mb-16">
<h2 class="text-4xl font-extrabold mb-4">Built for Scale</h2>
<p class="text-on-surface-variant">How we stack up against the competition.</p>
</div>
<div class="overflow-x-auto rounded-xl glass-panel border-none">
<table class="w-full text-left border-collapse">
<thead>
<tr class="bg-surface-container-high">
<th class="p-6 mono text-xs uppercase tracking-widest font-semibold opacity-50">Feature</th>
<th class="p-6 text-primary font-bold">MongoBranch</th>
<th class="p-6 text-on-surface-variant">Neon</th>
<th class="p-6 text-on-surface-variant">Dolt</th>
</tr>
</thead>
<tbody class="divide-y divide-outline-variant/10">
<tr>
<td class="p-6 font-semibold">Native MongoDB Protocol</td>
<td class="p-6 text-primary"><span class="material-symbols-outlined" data-icon="check" data-weight="fill">check</span></td>
<td class="p-6 text-on-surface-variant/40"><span class="material-symbols-outlined" data-icon="close">close</span></td>
<td class="p-6 text-on-surface-variant/40"><span class="material-symbols-outlined" data-icon="close">close</span></td>
</tr>
<tr>
<td class="p-6 font-semibold">Zero-Copy Branching</td>
<td class="p-6 text-primary"><span class="material-symbols-outlined" data-icon="check" data-weight="fill">check</span></td>
<td class="p-6 text-primary"><span class="material-symbols-outlined" data-icon="check" data-weight="fill">check</span></td>
<td class="p-6 text-on-surface-variant/40"><span class="material-symbols-outlined" data-icon="close">close</span></td>
</tr>
<tr>
<td class="p-6 font-semibold">MCP Server for AI Agents</td>
<td class="p-6 text-primary"><span class="material-symbols-outlined" data-icon="check" data-weight="fill">check</span></td>
<td class="p-6 text-on-surface-variant/40"><span class="material-symbols-outlined" data-icon="close">close</span></td>
<td class="p-6 text-on-surface-variant/40"><span class="material-symbols-outlined" data-icon="close">close</span></td>
</tr>
<tr>
<td class="p-6 font-semibold">Engine Diff Visualization</td>
<td class="p-6 text-primary"><span class="material-symbols-outlined" data-icon="check" data-weight="fill">check</span></td>
<td class="p-6 text-on-surface-variant/40"><span class="material-symbols-outlined" data-icon="close">close</span></td>
<td class="p-6 text-primary"><span class="material-symbols-outlined" data-icon="check" data-weight="fill">check</span></td>
</tr>
<tr class="bg-surface-container-high/30">
<td class="p-6 font-bold">Total Agent Compatibility</td>
<td class="p-6 font-bold text-primary">28/28 Features</td>
<td class="p-6 text-on-surface-variant">12/28</td>
<td class="p-6 text-on-surface-variant">08/28</td>
</tr>
</tbody>
</table>
</div>
</div>
</section>
<!-- Quick Start Section -->
<section class="py-24 bg-surface-container-lowest">
<div class="max-w-7xl mx-auto px-6">
<div class="mb-12">
<h2 class="text-4xl font-extrabold mb-4">0 to 1 in Seconds</h2>
<p class="text-on-surface-variant">Native Bun &amp; Docker support out of the box.</p>
</div>
<div class="grid lg:grid-cols-2 gap-8">
<!-- Installation -->
<div class="space-y-6">
<div class="glass-panel p-6 rounded-xl border-none">
<div class="flex justify-between items-center mb-4">
<span class="mono text-xs text-primary">Terminal</span>
<span class="material-symbols-outlined text-on-surface-variant text-sm" data-icon="content_copy">content_copy</span>
</div>
<pre class="mono text-sm leading-relaxed text-on-surface"><span class="text-secondary"># Install globally with Bun</span>
bun install -g @mongobranch/cli

<span class="text-secondary"># Pull &amp; Run with Docker</span>
docker run -p 27017:27017 mongobranch/server:latest</pre>
</div>
</div>
<!-- Flow -->
<div class="space-y-6">
<div class="glass-panel p-6 rounded-xl border-none">
<div class="flex justify-between items-center mb-4">
<span class="mono text-xs text-secondary">The Flow</span>
</div>
<div class="space-y-4 mono text-sm">
<div class="flex items-start gap-4">
<span class="text-primary font-bold">1</span>
<code class="text-on-surface">mb checkout -b agent-task-72</code>
</div>
<div class="flex items-start gap-4">
<span class="text-primary font-bold">2</span>
<code class="text-on-surface">mb status <span class="text-on-surface-variant opacity-50">// 14 docs modified</span></code>
</div>
<div class="flex items-start gap-4">
<span class="text-primary font-bold">3</span>
<code class="text-on-surface">mb commit -m "completed cleanup"</code>
</div>
<div class="flex items-start gap-4">
<span class="text-primary font-bold">4</span>
<code class="text-on-surface">mb merge main</code>
</div>
</div>
</div>
</div>
</div>
</div>
</section>
<!-- MCP Server Section -->
<section class="py-32 relative overflow-hidden">
<div class="absolute right-0 top-0 w-1/2 h-full bg-primary/5 blur-[120px] rounded-full"></div>
<div class="max-w-7xl mx-auto px-6 relative z-10">
<div class="grid md:grid-cols-2 gap-16 items-center">
<div>
<div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-secondary/10 text-secondary mono text-xs font-bold mb-6">
<span class="material-symbols-outlined text-sm" data-icon="memory">memory</span>
                        MCP SERVER ENABLED
                    </div>
<h2 class="text-5xl font-extrabold mb-6 leading-tight">72 Tools for <br/>AI Agents</h2>
<p class="text-xl text-on-surface-variant mb-8">Native Model Context Protocol (MCP) integration. Give Claude or Cursor the power to manage data versioning autonomously.</p>
<div class="space-y-4">
<div class="flex gap-4 p-4 rounded-lg bg-surface-container-low border-l-4 border-primary">
<div class="flex-shrink-0 mt-1">
<span class="material-symbols-outlined text-primary" data-icon="bolt">bolt</span>
</div>
<div>
<p class="font-bold">Two-Call Simplicity</p>
<p class="text-sm text-on-surface-variant">Standardized <code class="text-primary">start_task</code> and <code class="text-primary">complete_task</code> hooks for predictable agent behavior.</p>
</div>
</div>
</div>
</div>
<div class="glass-panel p-8 rounded-2xl">
<pre class="mono text-xs leading-relaxed text-secondary-dim">{
  "mcpServers": {
    "mongobranch": {
      "command": "npx",
      "args": ["-y", "@mongobranch/mcp-server"],
      "env": {
        "MB_API_KEY": "mb_live_...",
        "MB_AUTO_COMMIT": "true"
      },
      "tools": [
        "branch_create",
        "doc_diff",
        "snapshot_revert"
      ]
    }
  }
}</pre>
</div>
</div>
</div>
</section>
<!-- 22 Core Engines Grid -->
<section class="py-24 bg-surface-container-low">
<div class="max-w-7xl mx-auto px-6">
<div class="text-center mb-16">
<h2 class="text-4xl font-extrabold mb-4">22 Core Engines</h2>
<p class="text-on-surface-variant">The architecture that makes instant branching possible.</p>
</div>
<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
<!-- Engines -->
<div class="glass-panel p-6 rounded-xl hover:bg-surface-container-high transition-colors">
<span class="mono text-primary text-xs block mb-2">01</span>
<h4 class="font-bold">BranchManager</h4>
<p class="text-xs text-on-surface-variant mt-2">Low-latency isolation layer.</p>
</div>
<div class="glass-panel p-6 rounded-xl hover:bg-surface-container-high transition-colors">
<span class="mono text-primary text-xs block mb-2">02</span>
<h4 class="font-bold">CommitEngine</h4>
<p class="text-xs text-on-surface-variant mt-2">Deduplicated delta storage.</p>
</div>
<div class="glass-panel p-6 rounded-xl hover:bg-surface-container-high transition-colors">
<span class="mono text-primary text-xs block mb-2">03</span>
<h4 class="font-bold">DiffVisualizer</h4>
<p class="text-xs text-on-surface-variant mt-2">BSON structural comparisons.</p>
</div>
<div class="glass-panel p-6 rounded-xl hover:bg-surface-container-high transition-colors">
<span class="mono text-primary text-xs block mb-2">04</span>
<h4 class="font-bold">ProxyGateway</h4>
<p class="text-xs text-on-surface-variant mt-2">Native Mongo driver bridge.</p>
</div>
<div class="glass-panel p-6 rounded-xl hover:bg-surface-container-high transition-colors">
<span class="mono text-primary text-xs block mb-2">05</span>
<h4 class="font-bold">Snapshotter</h4>
<p class="text-xs text-on-surface-variant mt-2">Filesystem-level pointers.</p>
</div>
<div class="glass-panel p-6 rounded-xl hover:bg-surface-container-high transition-colors">
<span class="mono text-primary text-xs block mb-2">06</span>
<h4 class="font-bold">RebaseLogic</h4>
<p class="text-xs text-on-surface-variant mt-2">Conflict resolution algorithms.</p>
</div>
<div class="glass-panel p-6 rounded-xl hover:bg-surface-container-high transition-colors">
<span class="mono text-primary text-xs block mb-2">07</span>
<h4 class="font-bold">AgentSafety</h4>
<p class="text-xs text-on-surface-variant mt-2">Guardrails for AI interactions.</p>
</div>
<div class="glass-panel p-6 rounded-xl border border-primary/20 bg-primary/5 flex items-center justify-center">
<span class="mono text-primary text-sm font-bold">+ 15 more modules</span>
</div>
</div>
</div>
</section>
<!-- Footer Shell -->
<footer class="bg-[#051614] full-width p-12 mt-20">
<div class="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-7xl mx-auto items-start">
<div class="space-y-4">
<div class="text-lg font-bold text-[#46ff78] flex items-center gap-2">
<span class="material-symbols-outlined" data-icon="account_tree">account_tree</span>
                    MongoBranch
                </div>
<p class="text-[#9dafab] text-sm max-w-xs leading-relaxed">
                    MIT License. Built with Bun &amp; MongoDB. Versioning infrastructure for the AI era.
                </p>
</div>
<div class="grid grid-cols-2 gap-4">
<div class="flex flex-col gap-3">
<span class="mono text-xs uppercase tracking-widest text-[#46ff78]/50 mb-2">Resources</span>
<a class="text-[#9dafab] hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#46ff78]" href="#">Repo</a>
<a class="text-[#9dafab] hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#46ff78]" href="#">Documentation</a>
<a class="text-[#9dafab] hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#46ff78]" href="#">CLI Docs</a>
</div>
<div class="flex flex-col gap-3">
<span class="mono text-xs uppercase tracking-widest text-[#46ff78]/50 mb-2">Community</span>
<a class="text-[#9dafab] hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#46ff78]" href="#">X / Twitter</a>
<a class="text-[#9dafab] hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#46ff78]" href="#">Discord</a>
</div>
</div>
<div class="bg-surface-container p-6 rounded-xl">
<p class="text-white font-bold mb-2">Subscribe to updates</p>
<div class="flex gap-2">
<input class="bg-surface-container-low border-none rounded-lg text-sm w-full focus:ring-primary" placeholder="email@example.com" type="email"/>
<button class="bg-primary text-on-primary p-2 rounded-lg">
<span class="material-symbols-outlined" data-icon="arrow_forward">arrow_forward</span>
</button>
</div>
</div>
</div>
<div class="max-w-7xl mx-auto mt-12 pt-8 border-t border-outline-variant/10 text-center">
<p class="text-[#9dafab] text-xs">© 2024 MongoBranch. All rights reserved. Built for high-velocity teams.</p>
</div>
</footer>
</body></html>
