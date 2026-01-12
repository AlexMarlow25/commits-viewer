// Commit Timesheet Helper - VS Code extension entry
// Lightweight, no build step. Uses Vue via CDN inside the webview.

const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  let selectedRepos = [];
  const disposable = vscode.commands.registerCommand('commitTimesheet.open', async () => {
    const repos = await pickRepositories(context);
    if (!repos || !repos.length) {
      return;
    }
    selectedRepos = repos;
    const panel = vscode.window.createWebviewPanel(
      'commitTimesheet',
      'Commit Timesheet',
      vscode.ViewColumn.Active,
      { enableScripts: true },
    );

    const daysBack = getDaysBack();
    const commits = await fetchCommits(selectedRepos);
    panel.webview.html = buildHtml(panel.webview, commits, selectedRepos, daysBack);

    panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === 'copy') {
        await vscode.env.clipboard.writeText(msg.text || '');
        panel.webview.postMessage({ target: msg.target, type: 'copied' });
      }
      if (msg.type === 'refresh') {
        const nextDaysBack = getDaysBack();
        const next = await fetchCommits(selectedRepos);
        panel.webview.postMessage({ commits: next, repos: selectedRepos, daysBack: nextDaysBack, type: 'commits' });
      }
    });
  });

  context.subscriptions.push(disposable);
}

async function pickRepositories(context) {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || !folders.length) {
    vscode.window.showErrorMessage('Open a workspace to load commits.');
    return null;
  }

  const roots = folders.map((folder) => folder.uri.fsPath);
  const repos = await findGitRepos(roots);
  if (!repos.length) {
    vscode.window.showErrorMessage('No git repositories found in the workspace.');
    return null;
  }

  if (repos.length === 1) {
    context.workspaceState.update('commitTimesheet.repos', repos);
    return repos;
  }

  const items = [
    {
      label: 'All repositories',
      description: `${repos.length} found`,
      repoPath: '__all__',
      picked: false,
    },
    ...repos.map((repoPath) => ({
      label: workspaceRelativePath(repoPath) || path.basename(repoPath),
      description: repoPath,
      repoPath,
    })),
  ];

  const picked = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: 'Select repositories to include',
  });

  if (!picked || !picked.length) {
    return null;
  }

  const includeAll = picked.some((item) => item.repoPath === '__all__');
  const selected = includeAll
    ? repos
    : picked.map((item) => item.repoPath).filter((item) => item && item !== '__all__');

  context.workspaceState.update('commitTimesheet.repos', selected);
  return selected;
}

async function fetchCommits(repoPaths) {
  if (!repoPaths || !repoPaths.length) {
    return [];
  }

  const daysBack = getDaysBack();
  const authorSetting = getAuthorSetting();

  const since = `${daysBack} days ago`;
  const format = '%h%x1f%cI%x1f%s%x1f%an%x1e'; // use 0x1f field sep, 0x1e record sep

  const allCommits = [];

  for (const repoPath of repoPaths) {
    const author = (authorSetting && authorSetting.trim()) || safeExec('git config user.name', repoPath).trim();
    const authorPart = author ? ` --author="${author}"` : '';
    const raw = safeExec(`git log --all --since="${since}"${authorPart} --pretty=format:${format}`, repoPath);
    if (!raw.trim()) {
      continue;
    }

    raw
      .split('\x1e')
      .filter(Boolean)
      .forEach((line) => {
        const [hash, date, message, authorName] = line.split('\x1f');
        allCommits.push({
          author: authorName || author,
          date,
          hash,
          message,
          repoPath,
          repoLabel: workspaceRelativePath(repoPath) || path.basename(repoPath),
        });
      });
  }

  return allCommits;
}

async function findGitRepos(roots) {
  const repos = new Set();
  for (const root of roots) {
    await walkForRepos(root, repos);
  }
  return Array.from(repos);
}

async function walkForRepos(startPath, repos) {
  const queue = [startPath];
  const skipDirs = new Set(['.git', 'node_modules', 'dist', 'build', 'out', '.next', '.turbo', '.cache']);

  while (queue.length) {
    const current = queue.pop();
    if (!current) continue;

    let entries;
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch (err) {
      continue;
    }

    let hasGit = false;
    for (const entry of entries) {
      if (entry.name === '.git') {
        hasGit = true;
        break;
      }
    }

    if (hasGit) {
      repos.add(current);
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (!entry.isDirectory()) continue;
      if (skipDirs.has(entry.name)) continue;
      queue.push(path.join(current, entry.name));
    }
  }
}

function getDaysBack() {
  const config = vscode.workspace.getConfiguration();
  return config.get('commitTimesheet.daysBack') ?? 30;
}

function getAuthorSetting() {
  const config = vscode.workspace.getConfiguration();
  return config.get('commitTimesheet.author');
}

function safeExec(cmd, cwd) {
  try {
    return cp.execSync(cmd, { cwd, encoding: 'utf8' }).toString();
  } catch (err) {
    console.error('Command failed', cmd, err);
    return '';
  }
}

function workspaceRelativePath(targetPath) {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || !folders.length) return '';

  for (const folder of folders) {
    const root = folder.uri.fsPath;
    const relative = path.relative(root, targetPath);
    if (!relative.startsWith('..')) {
      return relative || path.basename(root);
    }
  }

  return '';
}

function buildHtml(webview, commits, repos, daysBack) {
  const nonce = String(Math.random()).slice(2);
  const commitsJson = JSON.stringify(commits || []).replace(/</g, '\\u003c');
  const reposJson = JSON.stringify(repos || []).replace(/</g, '\\u003c');
  const daysBackValue = Number.isFinite(daysBack) ? daysBack : 30;
  const csp = [
    'default-src \'none\'',
    'img-src https: data:',
    'style-src \'unsafe-inline\'',
    `script-src 'nonce-${nonce}' https://unpkg.com 'unsafe-eval'`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Commit Timesheet</title>
  ${styleBlock}
</head>
<body>
  <div id="app">
    <div class="shell">
      <header>
        <div>
          <h1>Commits — Last {{ daysBack }} Days</h1>
          <div class="badge">Your git author: <span>{{ authorName || 'local config' }}</span></div>
        </div>
        <div class="badge" :title="repoListTitle">{{ repoSummary }}</div>
        <div class="badge">{{ totalCountLabel }}</div>
      </header>

      <div class="controls">
        <div class="control">
          <label>Search</label>
          <input type="search" placeholder="filter by message, hash, scope" v-model="search">
        </div>
        <div class="control">
          <label>Type</label>
          <select v-model="typeFilter">
            <option value="all">All</option>
            <option value="feat">feat</option>
            <option value="fix">fix</option>
            <option value="refactor">refactor</option>
            <option value="build">build</option>
            <option value="merge">merge</option>
            <option value="other">other</option>
          </select>
        </div>
        <div class="control">
          <label>Since</label>
          <input type="date" v-model="since">
        </div>
      </div>

      <div class="toggles">
        <button class="pill" :class="{ active: sort === 'desc' }" @click="sort = 'desc'">Newest first</button>
        <button class="pill" :class="{ active: sort === 'asc' }" @click="sort = 'asc'">Oldest first</button>
        <button class="pill" @click="refresh">Refresh</button>
      </div>

      <div class="stats">
        <div class="stat">
          <div class="label">This view</div>
          <div class="value">{{ visibleCountLabel }}</div>
        </div>
        <div class="stat">
          <div class="label">Dominant type</div>
          <div class="value">{{ dominantTypeLabel }}</div>
        </div>
        <div class="stat">
          <div class="label">Last commit</div>
          <div class="value">{{ lastCommitLabel }}</div>
        </div>
      </div>

      <div class="list" v-if="!loading && grouped.length">
        <section class="group" v-for="group in grouped" :key="group.key">
          <div class="group__header">
            <div class="group__title">
              <span>{{ group.label }}</span>
              <span class="group__subtitle">{{ group.countLabel }}</span>
            </div>
            <button class="copy" type="button" @click="copyDay(group, $event)">Copy day summary</button>
          </div>
          <div class="group__body">
            <article class="card" v-for="commit in group.items" :key="commit.hash">
              <div class="card__top">
                <div class="hash">{{ commit.hash }}</div>
                <div class="type" :data-kind="commit.type">{{ commit.type }}</div>
                <div class="repo">{{ commit.repoLabel }}</div>
              </div>
              <div class="message">{{ commit.message }}</div>
              <div class="meta">
                <span>{{ commit.dateObj.toLocaleString() }}</span>
                <button class="copy" type="button" @click="copy(commit.hash, 'hash', $event)">Copy hash</button>
                <button class="copy" type="button" @click="copy(commit.message, 'subject', $event)">Copy subject</button>
              </div>
            </article>
          </div>
        </section>
      </div>

      <div class="empty" v-if="loading">Loading commits…</div>
      <div class="empty" v-else-if="!grouped.length">No commits match your filters.</div>

      <footer>Data pulled with <code>git log --since="X days ago"</code>. Adjust days/author in settings or hit Refresh.</footer>
    </div>
  </div>

  <script nonce="${nonce}" src="https://unpkg.com/vue@3/dist/vue.global.prod.js"></script>
  <script nonce="${nonce}">
    const { createApp, ref, computed, onMounted } = Vue;
    const vscode = acquireVsCodeApi();
    const initialCommits = ${commitsJson};
    const initialRepos = ${reposJson};
    const initialDaysBack = ${daysBackValue};

    function normalize(commits) {
      return (commits || []).map(commit => {
        const typeMatch = commit.message.match(/^([a-zA-Z]+)(?=\\(|:)/);
        const type = typeMatch ? typeMatch[1].toLowerCase() : "other";
        return { ...commit, type, dateObj: new Date(commit.date) };
      });
    }

    function formatDateLabel(key) {
      const labelDate = new Date(\`\${key}T00:00:00\`);
      return labelDate.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    }

    createApp({
      setup() {
        const commits = ref(normalize(initialCommits));
        const loading = ref(false);
        const authorName = ref(commits.value[0]?.author || "");
        const daysBack = ref(initialDaysBack);
        const repos = ref(initialRepos || []);
        const search = ref("");
        const typeFilter = ref("all");
        const sort = ref("desc");
        const since = ref(new Date(Date.now() - initialDaysBack * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));

        const totalCountLabel = computed(() =>
          commits.value.length ? \`\${commits.value.length} commits\` : "—"
        );

        const filtered = computed(() => {
          const term = search.value.trim().toLowerCase();
          const sinceDate = since.value ? new Date(\`\${since.value}T00:00:00\`) : null;

          return commits.value
            .filter(commit => {
              if (sinceDate && commit.dateObj < sinceDate) return false;
              if (typeFilter.value !== "all" && commit.type !== typeFilter.value) {
                if (!(typeFilter.value === "other" && !["feat", "fix", "refactor", "build", "merge"].includes(commit.type))) {
                  return false;
                }
              }
              if (!term) return true;
              const scopeMatch = commit.message.match(/\\((.*?)\\)/);
              const scope = scopeMatch ? scopeMatch[1] : "";
              return (
                commit.message.toLowerCase().includes(term) ||
                commit.hash.toLowerCase().includes(term) ||
                scope.toLowerCase().includes(term)
              );
            })
            .sort((a, b) => (sort.value === "desc" ? b.dateObj - a.dateObj : a.dateObj - b.dateObj));
        });

        const grouped = computed(() => {
          const map = {};
          filtered.value.forEach(commit => {
            const key = commit.dateObj.toISOString().slice(0, 10);
            if (!map[key]) map[key] = [];
            map[key].push(commit);
          });

          return Object.keys(map)
            .sort((a, b) => (sort.value === "desc" ? (a > b ? -1 : 1) : (a > b ? 1 : -1)))
            .map(key => ({
              key,
              label: formatDateLabel(key),
              countLabel: \`\${map[key].length} commit\${map[key].length === 1 ? "" : "s"}\`,
              items: map[key].sort((a, b) => (sort.value === "desc" ? b.dateObj - a.dateObj : a.dateObj - b.dateObj)),
            }));
        });

        const visibleCountLabel = computed(() => \`\${filtered.value.length} commits shown\`);

        const dominantTypeLabel = computed(() => {
          const counts = filtered.value.reduce((acc, c) => {
            const key = ["feat", "fix", "refactor", "build", "merge"].includes(c.type) ? c.type : "other";
            acc[key] = (acc[key] || 0) + 1;
            return acc;
          }, {});
          const [topType, topCount] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || ["—", 0];
          return topCount ? \`\${topType} (\${topCount})\` : "—";
        });

        const lastCommitLabel = computed(() => {
          if (!filtered.value.length) return "—";
          const last = sort.value === "desc" ? filtered.value[0] : filtered.value[filtered.value.length - 1];
          return \`\${last.message} — \${last.dateObj.toLocaleString()}\`;
        });

        function setCommits(next) {
          commits.value = normalize(next || []);
          authorName.value = commits.value[0]?.author || authorName.value;
          loading.value = false;
        }

        function copy(text, label, evt) {
          const btn = evt?.target;
          vscode.postMessage({ type: "copy", text, target: label });
          if (btn) {
            btn.textContent = "Copied!";
            setTimeout(() => (btn.textContent = \`Copy \${label}\`), 1200);
          }
        }

        function copyDay(group, evt) {
          const text = group.items.map(c => \`- \${c.message};\`).join("\\n");
          const btn = evt?.target;
          vscode.postMessage({ type: "copy", text, target: "day" });
          if (btn) {
            btn.textContent = "Copied!";
            setTimeout(() => (btn.textContent = "Copy day summary"), 1200);
          }
        }

        function refresh() {
          loading.value = true;
          vscode.postMessage({ type: "refresh" });
        }

        onMounted(() => {
          window.addEventListener("message", (event) => {
            const { type, commits: next, repos: nextRepos, daysBack: nextDaysBack } = event.data || {};
            if (type === "commits") {
              if (Array.isArray(nextRepos)) repos.value = nextRepos;
              if (Number.isFinite(nextDaysBack)) {
                daysBack.value = nextDaysBack;
                since.value = new Date(Date.now() - nextDaysBack * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
              }
              setCommits(next);
            }
          });
        });

        const repoSummary = computed(() => {
          if (!repos.value.length) return "Repos: —";
          return "Repos: " + repos.value.length;
        });

        const repoListTitle = computed(() => {
          return repos.value.length ? repos.value.join("\\n") : "No repositories selected";
        });

        return {
          commits,
          loading,
          authorName,
          daysBack,
          repos,
          search,
          typeFilter,
          since,
          sort,
          grouped,
          totalCountLabel,
          repoSummary,
          repoListTitle,
          visibleCountLabel,
          dominantTypeLabel,
          lastCommitLabel,
          copy,
          copyDay,
          refresh,
        };
      },
    }).mount("#app");
  </script>
</body>
</html>`;
}

const styleBlock = `<style>
  :root {
    --bg: linear-gradient(135deg, #0f172a, #1d2b4f 35%, #122b39 70%, #0b1724);
    --panel: rgba(255, 255, 255, 0.06);
    --panel-strong: rgba(255, 255, 255, 0.12);
    --accent: #48e5c2;
    --accent-2: #7bc7ff;
    --text: #e8edf5;
    --muted: #9fb3c8;
    --danger: #ff7b72;
    --shadow: 0 18px 50px rgba(0, 0, 0, 0.35);
    --radius: 16px;
    --blur: blur(14px);
    --font: "SF Pro Display", "Segoe UI", "Ubuntu", "Cantarell", "Inter", system-ui, -apple-system, sans-serif;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    background: var(--bg);
    color: var(--text);
    font-family: var(--font);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .shell {
    width: min(1100px, 100%);
    background: var(--panel);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    backdrop-filter: var(--blur);
    padding: 24px;
    position: relative;
    overflow: hidden;
  }
  .shell::before, .shell::after {
    content: "";
    position: absolute;
    border-radius: 50%;
    filter: blur(50px);
    opacity: 0.6;
    pointer-events: none;
  }
  .shell::before {
    width: 260px;
    height: 260px;
    background: radial-gradient(circle, rgba(72,229,194,0.25), transparent 60%);
    top: -80px;
    right: -60px;
  }
  .shell::after {
    width: 280px;
    height: 280px;
    background: radial-gradient(circle, rgba(123,199,255,0.28), transparent 60%);
    bottom: -100px;
    left: -80px;
  }
  header {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 18px;
    position: relative;
    z-index: 1;
  }
  h1 { margin: 0; font-size: 26px; letter-spacing: 0.4px; }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 999px;
    background: var(--panel-strong);
    color: var(--muted);
    font-size: 13px;
  }
  .controls {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
    margin-bottom: 14px;
    position: relative;
    z-index: 1;
  }
  .control {
    background: var(--panel);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    padding: 10px 12px;
    display: flex;
    gap: 10px;
    align-items: center;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
  }
  .control label { font-size: 12px; color: var(--muted); white-space: nowrap; }
  .control input, .control select {
    width: 100%;
    background: transparent;
    border: none;
    color: var(--text);
    font-size: 14px;
    outline: none;
  }
  .control input::placeholder { color: rgba(232, 237, 245, 0.7); }
  .toggles {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 14px;
    position: relative;
    z-index: 1;
  }
  .pill {
    padding: 8px 12px;
    background: var(--panel);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 999px;
    color: var(--text);
    font-size: 13px;
    cursor: pointer;
    transition: transform 120ms ease, border-color 120ms ease, background 120ms ease;
  }
  .pill:hover { transform: translateY(-1px); }
  .pill.active { border-color: var(--accent); color: var(--accent); background: rgba(72, 229, 194, 0.08); }
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 10px;
    margin-bottom: 12px;
  }
  .stat {
    padding: 10px;
    border-radius: 12px;
    background: var(--panel);
    border: 1px solid rgba(255, 255, 255, 0.05);
  }
  .stat .label { color: var(--muted); font-size: 12px; }
  .stat .value { font-size: 18px; margin-top: 4px; }
  .list { display: grid; gap: 12px; position: relative; z-index: 1; }
  .group {
    border-radius: 14px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.03);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
    overflow: hidden;
  }
  .group__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    background: rgba(0, 0, 0, 0.18);
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
  .group__title { font-size: 16px; font-weight: 600; display: flex; gap: 10px; align-items: center; }
  .group__subtitle { font-size: 13px; color: var(--muted); }
  .group__body { display: grid; gap: 10px; padding: 12px; }
  .card {
    padding: 14px 16px;
    border-radius: 14px;
    background: var(--panel);
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
    transition: transform 140ms ease, border-color 140ms ease, background 140ms ease;
  }
  .card:hover { transform: translateY(-2px); border-color: rgba(72, 229, 194, 0.3); background: rgba(255, 255, 255, 0.04); }
  .card__top { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; margin-bottom: 6px; flex-wrap: wrap; }
  .hash {
    font-family: "JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
    font-size: 14px;
    padding: 6px 10px;
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.25);
    color: var(--accent-2);
    letter-spacing: 0.2px;
  }
  .type {
    padding: 6px 10px;
    border-radius: 999px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: var(--muted);
  }
  .type[data-kind="feat"] { color: #9ef0c0; border-color: rgba(158, 240, 192, 0.3); }
  .type[data-kind="fix"] { color: var(--accent-2); border-color: rgba(123, 199, 255, 0.3); }
  .type[data-kind="refactor"] { color: #f4d35e; border-color: rgba(244, 211, 94, 0.4); }
  .type[data-kind="build"] { color: #f78da7; border-color: rgba(247, 141, 167, 0.35); }
  .type[data-kind="merge"] { color: var(--muted); }
  .repo {
    padding: 6px 10px;
    border-radius: 999px;
    font-size: 12px;
    border: 1px dashed rgba(255, 255, 255, 0.2);
    color: var(--accent-2);
  }
  .message { font-size: 16px; margin: 6px 0 8px; color: #f6f8ff; }
  .meta { display: flex; align-items: center; gap: 10px; color: var(--muted); font-size: 13px; flex-wrap: wrap; }
  button.copy {
    padding: 6px 10px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: transparent;
    color: var(--text);
    border-radius: 8px;
    cursor: pointer;
    font-size: 13px;
    transition: transform 120ms ease, border-color 120ms ease, background 120ms ease;
  }
  button.copy:hover { transform: translateY(-1px); border-color: var(--accent); }
  button.copy:active { transform: translateY(0); }
  .empty {
    text-align: center;
    padding: 30px;
    color: var(--muted);
    background: var(--panel);
    border-radius: 12px;
    border: 1px dashed rgba(255, 255, 255, 0.2);
  }
  footer { margin-top: 14px; color: var(--muted); font-size: 12px; text-align: right; }
  @media (max-width: 640px) { .card__top { flex-direction: column; align-items: flex-start; } body { padding: 14px; } .shell { padding: 18px; } }
</style>`;

function deactivate() {}

module.exports = { activate, deactivate };
