import { convertFileSrc } from "@tauri-apps/api/core";
import { open, confirm } from "@tauri-apps/plugin-dialog";
import { marked } from "marked";
import Fuse from 'fuse.js'
import { api } from "./api";
import type { Activity, JournalSummary, TimelineDay, View } from "./types";
import "./styles.css";
import {
  warn,
  debug,
  trace,
  info,
  error,
} from '@tauri-apps/plugin-log';

function forwardConsole(
  fnName: 'log' | 'debug' | 'info' | 'warn' | 'error',
  logger: (message: string) => Promise<void>
) {
  const original = console[fnName];
  console[fnName] = (message) => {
    original(message);
    logger(message);
  };
}

forwardConsole('log', trace);
forwardConsole('debug', debug);
forwardConsole('info', info);
forwardConsole('warn', warn);
forwardConsole('error', error);

marked.setOptions({ breaks: true, gfm: true });

interface AppState {
  view: View;
  journals: JournalSummary[];
  selectedId: number | null;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  activities: Activity[];
  timeline: TimelineDay[];
  categories: string[];
  selectedCategory: string;
  apiKeyInput: string;
  hasApiKey: boolean;
  saving: boolean;
  analyzing: boolean;
  dirty: boolean;
  statusMessage: string;
}

const state: AppState = {
  view: "journal",
  journals: [],
  selectedId: null,
  title: "",
  content: "",
  createdAt: "",
  updatedAt: "",
  activities: [],
  timeline: [],
  categories: [],
  selectedCategory: "",
  apiKeyInput: "",
  hasApiKey: false,
  saving: false,
  analyzing: false,
  dirty: false,
  statusMessage: "",
};

const app = document.getElementById("app")!;

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDayDate(date: string): string {
  const d = new Date(date + "T12:00:00");
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function categoryColor(category: string): string {
  const colors: Record<string, string> = {
    Work: "#6366f1",
    Health: "#22c55e",
    Social: "#f97316",
    Learning: "#3b82f6",
    Creative: "#a855f7",
    Travel: "#14b8a6",
    Food: "#eab308",
    Exercise: "#ef4444",
    Entertainment: "#ec4899",
    Personal: "#64748b",
  };
  return colors[category] ?? "#64748b";
}

function renderMarkdown(text: string): string {
  const withImages = text.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (_match, alt, src) => {
      const resolved = src.startsWith("journal-image://")
        ? convertFileSrc(src.replace("journal-image://", ""))
        : src.startsWith("/") || src.includes(":\\")
          ? convertFileSrc(src)
          : src;
      return `![${alt}](${resolved})`;
    },
  );
  return marked.parse(withImages) as string;
}

function setStatus(msg: string, isError = false) {
  state.statusMessage = msg;
  const el = document.querySelector(".status-bar");
  if (el) {
    el.textContent = msg;
    el.classList.toggle("error", isError);
  }
}

async function loadJournals() {
  state.journals = await api.listJournals();
  render();
}

async function loadJournal(id: number) {
  const journal = await api.getJournal(id);
  state.selectedId = journal.id;
  state.title = journal.title;
  state.content = journal.content;
  state.createdAt = journal.created_at;
  state.updatedAt = journal.updated_at;
  state.activities = await api.getJournalActivities(id);
  state.dirty = false;
  render();
}

function newJournal() {
  state.selectedId = null;
  state.title = "";
  state.content = "";
  state.createdAt = "";
  state.updatedAt = "";
  state.activities = [];
  state.dirty = false;
  render();
  document.querySelector<HTMLInputElement>(".title-input")?.focus();
}

async function saveJournal() {
  if (!state.title.trim()) {
    setStatus("Please enter a title", true);
    return;
  }
  state.saving = true;
  render();
  try {
    if (state.selectedId === null) {
      const journal = await api.createJournal(state.title, state.content);
      state.selectedId = journal.id;
      state.createdAt = journal.created_at;
      state.updatedAt = journal.updated_at;
    } else {
      const journal = await api.updateJournal(
        state.selectedId,
        state.title,
        state.content,
      );
	  state.updatedAt = journal.updated_at;
	  
	  const pairs = state.activities.map(x => [x.description, x.category]);
	  await api.updateActivities(pairs, state.selectedId);
    }
    state.dirty = false;
    await loadJournals();
    setStatus("Saved");
  } catch (e) {
    setStatus(String(e), true);
  } finally {
    state.saving = false;
    render();
  }
}

async function deleteJournal(id: number) {
  if (!(await confirm("Delete this journal entry?", { title: 'Delete Entry', kind: 'warning' }))) return;
  await api.deleteJournal(id);
  if (state.selectedId === id) newJournal();
  await loadJournals();
  setStatus("Deleted");
}

async function analyzeJournal() {
  if (state.selectedId === null) {
    setStatus("Save the journal first before analyzing", true);
    return;
  }
  if (state.dirty) await saveJournal();
  state.analyzing = true;
  render();
  try {
    state.activities = await api.analyzeJournal(state.selectedId);
    setStatus(`Found ${state.activities.length} activities`);
  } catch (e) {
    setStatus(String(e), true);
  } finally {
    state.analyzing = false;
    render();
  }
}

async function insertImage() {
  const selected = await open({
    multiple: false,
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
  });
  if (!selected || typeof selected !== "string") return;

  const savedPath = await api.importJournalImage(selected);
  const filename = selected.split(/[/\\]/).pop() ?? "image.png";
  const markdown = `\n![${filename}](journal-image://${savedPath})\n`;
  state.content += markdown;
  state.dirty = true;
  render();
  updatePreview();
}

async function loadTimeline(reload_timeline: boolean = true) {
  if (reload_timeline) {
	state.timeline = await api.getTimeline(
      state.selectedCategory || undefined,
    );
  }
  state.categories = await api.getCategories();
  render();
}

async function loadSettings() {
  state.hasApiKey = await api.hasGeminiApiKey();
  render();
}

async function saveApiKey() {
  if (!state.apiKeyInput.trim()) return;
  await api.setGeminiApiKey(state.apiKeyInput.trim());
  state.apiKeyInput = "";
  state.hasApiKey = true;
  setStatus("API key saved");
  render();
}

function switchView(view: View) {
  state.view = view;
  if (view === "timeline") loadTimeline();
  if (view === "settings") loadSettings();
  render();
}

function updatePreview() {
  const preview = document.querySelector(".preview-pane");
  if (preview) preview.innerHTML = renderMarkdown(state.content);
}

function renderSidebar() {
  return `
    <aside class="sidebar">
      <div class="sidebar-header">
        <div class="logo">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
          </svg>
          <span>Dayline</span>
        </div>
        <button class="btn btn-primary btn-new" data-action="new">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          New Entry
        </button>
      </div>

      <nav class="nav-tabs">
        <button class="nav-tab ${state.view === "journal" ? "active" : ""}" data-view="journal">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
          Write
        </button>
        <button class="nav-tab ${state.view === "timeline" ? "active" : ""}" data-view="timeline">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="20" x2="12" y2="10"/>
            <line x1="18" y1="20" x2="18" y2="4"/>
            <line x1="6" y1="20" x2="6" y2="16"/>
          </svg>
          Timeline
        </button>
        <button class="nav-tab ${state.view === "settings" ? "active" : ""}" data-view="settings">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
          Settings
        </button>
      </nav>

      ${
        state.view === "journal"
          ? `
        <div class="journal-list">
          <div class="list-header">Entries</div>
          ${
            state.journals.length === 0
              ? '<p class="empty-list">No entries yet</p>'
              : state.journals
                  .map(
                    (j) => `
              <div class="journal-item ${state.selectedId === j.id ? "active" : ""}" data-id="${j.id}">
                <div class="journal-item-title">${escapeHtml(j.title || "Untitled")}</div>
                <div class="journal-item-date">${formatDate(j.updated_at)}</div>
                <button class="journal-item-delete" data-delete="${j.id}" title="Delete">&times;</button>
              </div>`,
                  )
                  .join("")
          }
        </div>`
          : ""
      }
    </aside>`;
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function renderJournalView() {
  return `
    <div class="editor-view">
      <div class="editor-header">
        <input
          class="title-input"
          type="text"
          placeholder="Entry title..."
          value="${escapeHtml(state.title)}"
        />
        <div class="editor-meta">
          ${
            state.createdAt
              ? `<span>Created ${formatDate(state.createdAt)}</span>
                 <span>Modified ${formatDate(state.updatedAt)}</span>`
              : "<span>New entry</span>"
          }
        </div>
        <div class="editor-actions">
          <button class="btn btn-ghost" data-action="insert-image" title="Insert image">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
            Image
          </button>
          <button class="btn btn-ghost" data-action="analyze" ${state.analyzing ? "disabled" : ""}>
            ${state.analyzing ? "Analyzing..." : "Analyze with AI"}
          </button>
          <button class="btn btn-primary" data-action="save" ${state.saving ? "disabled" : ""}>
            ${state.saving ? "Saving..." : state.dirty ? "Save *" : "Save"}
          </button>
        </div>
      </div>

      <div class="editor-panes">
        <textarea class="editor-pane" placeholder="Write your journal in Markdown...">${escapeHtml(state.content)}</textarea>
        <div class="preview-pane markdown-body">${renderMarkdown(state.content)}</div>
      </div>

      ${
        state.activities.length > 0
          ? `
        <div class="activities-panel">
          <h3>Extracted Activities</h3>
          <div class="activities-grid">
            ${state.activities
              .map(
                (a, index) => `
              <div class="activity-card activity-card${index}">
                <span contenteditable="true" class="activity-badge activity-badge${index}" style="background:${categoryColor(a.category)}">${escapeHtml(a.category)}</span>
                <span contenteditable="true" class="activity-desc activity-desc${index}">${escapeHtml(a.description)}</span>
				<button class="activity-delete activity-delete${index}" title="Delete">&times;</button>
              </div>`,
              )
              .join("")}
          </div>
        </div>`
          : ""
      }
    </div>`;
}

function renderTimelineView() {
  return `
    <div class="timeline-view">
      <div class="timeline-header">
        <h2>Activity Timeline</h2>
        <p class="timeline-subtitle">See what you did each day</p>
        <div class="category-filters">
          <button class="filter-chip ${!state.selectedCategory ? "active" : ""}" data-category="">
            All
          </button>
          ${state.categories
            .map(
              (cat) => `
            <button class="filter-chip ${state.selectedCategory === cat ? "active" : ""}"
                    data-category="${escapeHtml(cat)}"
                    style="--chip-color: ${categoryColor(cat)}">
              ${escapeHtml(cat)}
            </button>`,
            )
            .join("")}
        </div>
		<div class="activity-search">
		  <input
            class="search-input"
            type="text"
            placeholder="Search..."
          />
		  <button class="search-btn" data-action="search" aria-label="Search">
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="search-icon">
			  <circle cx="11" cy="11" r="8"></circle>
			  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
	   	    </svg>
		  </button>
		</div>
      </div>

      <div class="timeline-content">
        ${
          state.timeline.length === 0
            ? `<div class="empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
                  <line x1="12" y1="20" x2="12" y2="10"/>
                  <line x1="18" y1="20" x2="18" y2="4"/>
                  <line x1="6" y1="20" x2="6" y2="16"/>
                </svg>
                <p>No activities yet</p>
                <span>Write a journal entry and use "Analyze with AI" to populate your timeline</span>
              </div>`
            : state.timeline
                .map(
                  (day) => `
              <div class="timeline-day">
                <div class="timeline-date">
                  <div class="timeline-dot"></div>
                  <span>${formatDayDate(day.date)}</span>
                </div>
                <div class="timeline-activities">
                  ${day.activities
                    .map(
                      (a) => `
                    <div class="timeline-card" data-id="${a.journal_id}">
                      <span class="activity-badge" style="background:${categoryColor(a.category)}">${escapeHtml(a.category)}</span>
                      <p>${escapeHtml(a.description)}</p>
                    </div>`,
                    )
                    .join("")}
                </div>
              </div>`,
                )
                .join("")
        }
      </div>
    </div>`;
}

function renderSettingsView() {
  return `
    <div class="settings-view">
      <h2>Settings</h2>
      <div class="settings-card">
        <h3>Gemini API Key</h3>
        <p class="settings-desc">
          Required for AI activity analysis. Get a key from
          <a href="#" data-link="https://aistudio.google.com/apikey">Google AI Studio</a>.
        </p>
        <div class="settings-status ${state.hasApiKey ? "configured" : ""}">
          ${state.hasApiKey ? "API key configured" : "No API key configured"}
        </div>
        <div class="settings-input-row">
          <input
            type="password"
            class="settings-input"
            placeholder="Enter your Gemini API key..."
            value="${escapeHtml(state.apiKeyInput)}"
          />
          <button class="btn btn-primary" data-action="save-api-key">Save Key</button>
        </div>
      </div>
    </div>`;
}

function render() {
  app.innerHTML = `
    <div class="app-layout">
      ${renderSidebar()}
      <main class="main-content">
        ${
          state.view === "journal"
            ? renderJournalView()
            : state.view === "timeline"
              ? renderTimelineView()
              : renderSettingsView()
        }
      </main>
      <footer class="status-bar">${state.statusMessage}</footer>
    </div>`;

  bindEvents();
}

function bindEvents() {
  document.querySelectorAll("[data-view]").forEach((el) => {
    el.addEventListener("click", () => {
      switchView(el.getAttribute("data-view") as View);
    });
  });

  document.querySelector("[data-action='new']")?.addEventListener("click", newJournal);
  document.querySelector("[data-action='save']")?.addEventListener("click", saveJournal);
  document.querySelector("[data-action='analyze']")?.addEventListener("click", analyzeJournal);
  document.querySelector("[data-action='insert-image']")?.addEventListener("click", insertImage);
  document.querySelector("[data-action='save-api-key']")?.addEventListener("click", saveApiKey);
  
  document.querySelector("[data-action='search']")?.addEventListener("click", () => {
	const search_input = document.querySelector(".search-input");
	if (search_input.value == "") {
	  loadTimeline();
	  return;
	}
	const docs = state.timeline.map(day => day.activities).flat();
	const fuse = new Fuse(docs, {
	  keys: ['description', 'category']
	});
	let result = fuse.search(search_input.value);
	result = result.map(x => {
	  const day: TimelineDay = {};
	  day.activities = [x["item"]];
	  day.date = x["item"].activity_date;
	  return day;
	});
	state.timeline = result;
	loadTimeline(false);
  });
  
  document.querySelector(".search-input")?.addEventListener("keydown", (event) => {
	if (event.key === "Enter") {
	  event.preventDefault();
	  document.querySelector("[data-action='search']")?.click();
    }
  });

  document.querySelectorAll(".journal-item").forEach((el) => {
    el.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("[data-delete]")) return;
      const id = Number(el.getAttribute("data-id"));
      loadJournal(id);
    });
  });
  
  document.querySelectorAll(".timeline-card").forEach((el) => {
    el.addEventListener("click", (e) => {
      const id = Number(el.getAttribute("data-id"));
	  switchView("journal");
      loadJournal(id);
    });
  });

  document.querySelectorAll("[data-delete]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteJournal(Number(el.getAttribute("data-delete")));
    });
  });

  document.querySelectorAll("[data-category]").forEach((el) => {
    el.addEventListener("click", () => {
      state.selectedCategory = el.getAttribute("data-category") ?? "";
      loadTimeline();
    });
  });

  document.querySelector("[data-link]")?.addEventListener("click", async (e) => {
    e.preventDefault();
    const url = (e.currentTarget as HTMLElement).getAttribute("data-link");
    if (url) {
      const { open: openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    }
  });

  const titleInput = document.querySelector<HTMLInputElement>(".title-input");
  titleInput?.addEventListener("input", () => {
    state.title = titleInput.value;
    state.dirty = true;
    const saveBtn = document.querySelector("[data-action='save']");
    if (saveBtn) saveBtn.textContent = "Save *";
  });

  const editor = document.querySelector<HTMLTextAreaElement>(".editor-pane");
  editor?.addEventListener("input", () => {
    state.content = editor.value;
    state.dirty = true;
    updatePreview();
    const saveBtn = document.querySelector("[data-action='save']");
    if (saveBtn) saveBtn.textContent = "Save *";
  });
  
  for (let i=0; i<state.activities.length; i++) {
	  const activity_badge = document.querySelector<HTMLTextAreaElement>(`.activity-badge${i}`);
	  activity_badge?.addEventListener("input", (event) => {
		state.activities[i].category = event.target.innerText;
		state.dirty = true;
		updatePreview();
		const saveBtn = document.querySelector("[data-action='save']");
		if (saveBtn) saveBtn.textContent = "Save *";
	  });
	  
	  const activity_desc = document.querySelector<HTMLTextAreaElement>(`.activity-desc${i}`);
	  activity_desc?.addEventListener("input", (event) => {
		state.activities[i].description = event.target.innerText;
		state.dirty = true;
		updatePreview();
		const saveBtn = document.querySelector("[data-action='save']");
		if (saveBtn) saveBtn.textContent = "Save *";
	  });
	  
	  const activity_del = document.querySelector(`.activity-delete${i}`);
	  activity_del?.addEventListener("click", async (event) => {
		event.stopPropagation();
		if (!(await confirm("Delete this activity?", { title: 'Delete Activity', kind: 'warning' }))) return;
        state.activities.splice(i, 1);
		state.dirty = true;
		document.querySelector(`.activity-card${i}`).remove();
		updatePreview();
		const saveBtn = document.querySelector("[data-action='save']");
		if (saveBtn) saveBtn.textContent = "Save *";
	  });
  }

  const apiKeyInput = document.querySelector<HTMLInputElement>(".settings-input");
  apiKeyInput?.addEventListener("input", () => {
    state.apiKeyInput = apiKeyInput.value;
  });

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      if (state.view === "journal") saveJournal();
    }
  });
}

async function init() {
  await loadJournals();
  state.hasApiKey = await api.hasGeminiApiKey();
  render();
}

init();
