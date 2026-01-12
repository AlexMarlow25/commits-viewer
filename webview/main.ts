import { createApp } from "vue";
import App from "./App.vue";

type InitialState = {
  commits: Array<{
    author: string;
    date: string;
    hash: string;
    message: string;
    repoPath?: string;
    repoLabel?: string;
  }>;
  repos: string[];
  daysBack: number;
};

declare const acquireVsCodeApi: () => { postMessage: (message: unknown) => void };

const vscode = acquireVsCodeApi();
const initialState = (window as Window & { __INITIAL_STATE__?: InitialState }).__INITIAL_STATE__ ?? {
  commits: [],
  repos: [],
  daysBack: 30,
};

createApp(App, { vscode, initialState }).mount("#app");
