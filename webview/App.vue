<template>
  <div class="shell">
    <header>
      <div>
        <h1>Commits — Last {{ daysBack }} Days</h1>
        <div class="badge">Your git author: <span>{{ authorName || "local config" }}</span></div>
      </div>
      <div class="badge" :title="repoListTitle">{{ repoSummary }}</div>
      <div class="badge">{{ totalCountLabel }}</div>
    </header>

    <div class="controls">
      <div class="control">
        <label>Search</label>
        <input type="search" placeholder="filter by message, hash, scope" v-model="search" />
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
        <input type="date" v-model="since" />
      </div>
    </div>

    <div class="toggles">
      <button class="pill" :class="{ active: sort === 'desc' }" @click="sort = 'desc'">
        Newest first
      </button>
      <button class="pill" :class="{ active: sort === 'asc' }" @click="sort = 'asc'">
        Oldest first
      </button>
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
              <div class="repo" v-if="commit.repoLabel">{{ commit.repoLabel }}</div>
            </div>
            <div class="message">{{ commit.message }}</div>
            <div class="meta">
              <span>{{ commit.dateObj.toLocaleString() }}</span>
              <button class="copy" type="button" @click="copy(commit.hash, 'hash', $event)">Copy hash</button>
              <button class="copy" type="button" @click="copy(commit.message, 'subject', $event)">
                Copy subject
              </button>
            </div>
          </article>
        </div>
      </section>
    </div>

    <div class="empty" v-if="loading">Loading commits…</div>
    <div class="empty" v-else-if="!grouped.length">No commits match your filters.</div>

    <footer>
      Data pulled with <code>git log --since="X days ago"</code>. Adjust days/author in settings or hit
      Refresh.
    </footer>
  </div>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref } from "vue";

type RawCommit = {
  author: string;
  date: string;
  hash: string;
  message: string;
  repoPath?: string;
  repoLabel?: string;
};

type Commit = RawCommit & {
  type: string;
  dateObj: Date;
};

type InitialState = {
  commits: RawCommit[];
  repos: string[];
  daysBack: number;
};

const props = defineProps<{
  vscode: { postMessage: (message: unknown) => void };
  initialState: InitialState;
}>();

const typeKinds = ["feat", "fix", "refactor", "build", "merge"];

function normalize(commits: RawCommit[]): Commit[] {
  return (commits || []).map((commit) => {
    const typeMatch = commit.message.match(/^([a-zA-Z]+)(?=\(|:)/);
    const type = typeMatch ? typeMatch[1].toLowerCase() : "other";
    return { ...commit, type, dateObj: new Date(commit.date) };
  });
}

function formatDateLabel(key: string) {
  const labelDate = new Date(`${key}T00:00:00`);
  return labelDate.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const commits = ref<Commit[]>(normalize(props.initialState.commits || []));
const loading = ref(false);
const authorName = ref(commits.value[0]?.author || "");
const daysBack = ref(Number.isFinite(props.initialState.daysBack) ? props.initialState.daysBack : 30);
const repos = ref(props.initialState.repos || []);
const search = ref("");
const typeFilter = ref("all");
const sort = ref<"desc" | "asc">("desc");
const since = ref(new Date(Date.now() - daysBack.value * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));

const totalCountLabel = computed(() => (commits.value.length ? `${commits.value.length} commits` : "—"));

const filtered = computed(() => {
  const term = search.value.trim().toLowerCase();
  const sinceDate = since.value ? new Date(`${since.value}T00:00:00`) : null;

  return commits.value
    .filter((commit) => {
      if (sinceDate && commit.dateObj < sinceDate) return false;
      if (typeFilter.value !== "all" && commit.type !== typeFilter.value) {
        if (!(typeFilter.value === "other" && !typeKinds.includes(commit.type))) {
          return false;
        }
      }
      if (!term) return true;
      const scopeMatch = commit.message.match(/\((.*?)\)/);
      const scope = scopeMatch ? scopeMatch[1] : "";
      return (
        commit.message.toLowerCase().includes(term) ||
        commit.hash.toLowerCase().includes(term) ||
        scope.toLowerCase().includes(term)
      );
    })
    .sort((a, b) => (sort.value === "desc" ? b.dateObj.getTime() - a.dateObj.getTime() : a.dateObj.getTime() - b.dateObj.getTime()));
});

const grouped = computed(() => {
  const map: Record<string, Commit[]> = {};
  filtered.value.forEach((commit) => {
    const key = commit.dateObj.toISOString().slice(0, 10);
    if (!map[key]) map[key] = [];
    map[key].push(commit);
  });

  return Object.keys(map)
    .sort((a, b) => (sort.value === "desc" ? (a > b ? -1 : 1) : a > b ? 1 : -1))
    .map((key) => ({
      key,
      label: formatDateLabel(key),
      countLabel: `${map[key].length} commit${map[key].length === 1 ? "" : "s"}`,
      items: map[key].sort((a, b) =>
        sort.value === "desc" ? b.dateObj.getTime() - a.dateObj.getTime() : a.dateObj.getTime() - b.dateObj.getTime()
      ),
    }));
});

const visibleCountLabel = computed(() => `${filtered.value.length} commits shown`);

const dominantTypeLabel = computed(() => {
  const counts = filtered.value.reduce<Record<string, number>>((acc, commit) => {
    const key = typeKinds.includes(commit.type) ? commit.type : "other";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const [topType, topCount] = entries[0] || ["—", 0];
  return topCount ? `${topType} (${topCount})` : "—";
});

const lastCommitLabel = computed(() => {
  if (!filtered.value.length) return "—";
  const last = sort.value === "desc" ? filtered.value[0] : filtered.value[filtered.value.length - 1];
  return `${last.message} — ${last.dateObj.toLocaleString()}`;
});

function setCommits(next: RawCommit[]) {
  commits.value = normalize(next || []);
  authorName.value = commits.value[0]?.author || authorName.value;
  loading.value = false;
}

function copy(text: string, label: string, event: Event) {
  const button = event?.target as HTMLButtonElement | null;
  props.vscode.postMessage({ type: "copy", text, target: label });
  if (button) {
    button.textContent = "Copied!";
    window.setTimeout(() => {
      button.textContent = `Copy ${label}`;
    }, 1200);
  }
}

function copyDay(group: { items: Commit[] }, event: Event) {
  const text = group.items.map((commit) => `- ${commit.message};`).join("\n");
  const button = event?.target as HTMLButtonElement | null;
  props.vscode.postMessage({ type: "copy", text, target: "day" });
  if (button) {
    button.textContent = "Copied!";
    window.setTimeout(() => {
      button.textContent = "Copy day summary";
    }, 1200);
  }
}

function refresh() {
  loading.value = true;
  props.vscode.postMessage({ type: "refresh" });
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
      setCommits(next || []);
    }
  });
});

const repoSummary = computed(() => {
  if (!repos.value.length) return "Repos: —";
  return `Repos: ${repos.value.length}`;
});

const repoListTitle = computed(() => (repos.value.length ? repos.value.join("\n") : "No repositories selected"));
</script>

<style>
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
  --font: "SF Pro Display", "Segoe UI", "Ubuntu", "Cantarell", system-ui, -apple-system, sans-serif;
}
* {
  box-sizing: border-box;
}
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
.shell::before,
.shell::after {
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
  background: radial-gradient(circle, rgba(72, 229, 194, 0.25), transparent 60%);
  top: -80px;
  right: -60px;
}
.shell::after {
  width: 280px;
  height: 280px;
  background: radial-gradient(circle, rgba(123, 199, 255, 0.28), transparent 60%);
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
h1 {
  margin: 0;
  font-size: 26px;
  letter-spacing: 0.4px;
}
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
.control label {
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
}
.control input,
.control select {
  width: 100%;
  background: transparent;
  border: none;
  color: var(--text);
  font-size: 14px;
  outline: none;
}
.control input::placeholder {
  color: rgba(232, 237, 245, 0.7);
}
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
.pill:hover {
  transform: translateY(-1px);
}
.pill.active {
  border-color: var(--accent);
  color: var(--accent);
  background: rgba(72, 229, 194, 0.08);
}
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
.stat .label {
  color: var(--muted);
  font-size: 12px;
}
.stat .value {
  font-size: 18px;
  margin-top: 4px;
}
.list {
  display: grid;
  gap: 12px;
  position: relative;
  z-index: 1;
}
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
.group__title {
  font-size: 16px;
  font-weight: 600;
  display: flex;
  gap: 10px;
  align-items: center;
}
.group__subtitle {
  font-size: 13px;
  color: var(--muted);
}
.group__body {
  display: grid;
  gap: 10px;
  padding: 12px;
}
.card {
  padding: 14px 16px;
  border-radius: 14px;
  background: var(--panel);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
  transition: transform 140ms ease, border-color 140ms ease, background 140ms ease;
}
.card:hover {
  transform: translateY(-2px);
  border-color: rgba(72, 229, 194, 0.3);
  background: rgba(255, 255, 255, 0.04);
}
.card__top {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: baseline;
  margin-bottom: 6px;
  flex-wrap: wrap;
}
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
.type[data-kind="feat"] {
  color: #9ef0c0;
  border-color: rgba(158, 240, 192, 0.3);
}
.type[data-kind="fix"] {
  color: var(--accent-2);
  border-color: rgba(123, 199, 255, 0.3);
}
.type[data-kind="refactor"] {
  color: #f4d35e;
  border-color: rgba(244, 211, 94, 0.4);
}
.type[data-kind="build"] {
  color: #f78da7;
  border-color: rgba(247, 141, 167, 0.35);
}
.type[data-kind="merge"] {
  color: var(--muted);
}
.repo {
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 12px;
  border: 1px dashed rgba(255, 255, 255, 0.2);
  color: var(--accent-2);
}
.message {
  font-size: 16px;
  margin: 6px 0 8px;
  color: #f6f8ff;
}
.meta {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--muted);
  font-size: 13px;
  flex-wrap: wrap;
}
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
button.copy:hover {
  transform: translateY(-1px);
  border-color: var(--accent);
}
button.copy:active {
  transform: translateY(0);
}
.empty {
  text-align: center;
  padding: 30px;
  color: var(--muted);
  background: var(--panel);
  border-radius: 12px;
  border: 1px dashed rgba(255, 255, 255, 0.2);
}
footer {
  margin-top: 14px;
  color: var(--muted);
  font-size: 12px;
  text-align: right;
}
@media (max-width: 640px) {
  .card__top {
    flex-direction: column;
    align-items: flex-start;
  }
  body {
    padding: 14px;
  }
  .shell {
    padding: 18px;
  }
}
</style>
