import { invoke } from "@tauri-apps/api/core";
import type { Activity, Journal, JournalSummary, TimelineDay } from "./types";

export const api = {
  createJournal: (title: string, content: string) =>
    invoke<Journal>("create_journal", { title, content }),

  updateJournal: (id: number, title: string, content: string) =>
    invoke<Journal>("update_journal", { id, title, content }),

  deleteJournal: (id: number) => invoke<void>("delete_journal", { id }),

  getJournal: (id: number) => invoke<Journal>("get_journal", { id }),

  listJournals: () => invoke<JournalSummary[]>("list_journals"),

  analyzeJournal: (id: number) => invoke<Activity[]>("analyze_journal", { id }),

  getJournalActivities: (journalId: number) =>
    invoke<Activity[]>("get_journal_activities", { journalId }),

  updateActivities: (pairs: [string, string][], id: number) => invoke<Activity[]>("update_activities", { pairs, id }),

  getTimeline: (category?: string) =>
    invoke<TimelineDay[]>("get_timeline", { category: category ?? null }),

  getCategories: () => invoke<string[]>("get_categories"),

  setGeminiApiKey: (key: string) => invoke<void>("set_gemini_api_key", { key }),

  hasGeminiApiKey: () => invoke<boolean>("has_gemini_api_key"),

  importJournalImage: (sourcePath: string) =>
    invoke<string>("import_journal_image", { sourcePath }),
};
