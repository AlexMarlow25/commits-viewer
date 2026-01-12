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
    panel.webview.html = buildHtml(panel.webview, context.extensionUri, commits, selectedRepos, daysBack);

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

function buildHtml(webview, extensionUri, commits, repos, daysBack) {
  const nonce = String(Math.random()).slice(2);
  const commitsJson = JSON.stringify(commits || []).replace(/</g, '\\u003c');
  const reposJson = JSON.stringify(repos || []).replace(/</g, '\\u003c');
  const daysBackValue = Number.isFinite(daysBack) ? daysBack : 30;
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'webview.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'webview.css'));
  const csp = [
    'default-src \'none\'',
    `img-src ${webview.cspSource} https: data:`,
    `style-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Commit Timesheet</title>
  <link rel="stylesheet" href="${styleUri}">
</head>
<body>
  <div id="app">
  </div>

  <script nonce="${nonce}">
    window.__INITIAL_STATE__ = {
      commits: ${commitsJson},
      repos: ${reposJson},
      daysBack: ${daysBackValue}
    };
  </script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function deactivate() {}

module.exports = { activate, deactivate };
