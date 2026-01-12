#!/usr/bin/env node
import { execSync } from 'child_process';
import fs from 'fs';
/**
 * Tiny server to expose git commits for the last month at /api/commits
 * and serve commits.html for convenience. ESM-compatible.
 */
import http from 'http';
import path from 'path';

const PORT = process.env.PORT || 3030;
const ROOT = process.cwd();

function getCommits() {
  const author = execSync('git config user.name').toString().trim();
  const raw = execSync(
    'git log --since="1 month ago" --author="$(git config user.name)" --pretty=format:"%h|%cI|%s"',
  )
    .toString()
    .trim();

  if (!raw)
    return [];

  return raw.split('\n').map((line) => {
    const [hash, date, ...rest] = line.split('|');
    return {
      author,
      date,
      hash,
      message: rest.join('|'), // in case the message contains pipes
    };
  });
}

function serveFile(res, filePath, contentType = 'text/html') {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.url === '/api/commits') {
    try {
      const commits = getCommits();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(commits));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (req.url === '/' || req.url.startsWith('/commits.html')) {
    const filePath = path.join(ROOT, 'commits.html');
    return serveFile(res, filePath, 'text/html');
  }

  // Static fallback for anything else in root.
  const safePath = path.normalize(req.url.replace(/^\//, ''));
  const resolved = path.join(ROOT, safePath);
  if (resolved.startsWith(ROOT) && fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    const ext = path.extname(resolved).toLowerCase();
    const type
      = ext === '.js'
        ? 'text/javascript'
        : ext === '.css'
          ? 'text/css'
          : ext === '.json'
            ? 'application/json'
            : 'text/plain';
    return serveFile(res, resolved, type);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Commits server listening on http://localhost:${PORT}`);
  console.log(`- API: http://localhost:${PORT}/api/commits`);
  console.log(`- UI:  http://localhost:${PORT}/`);
});
