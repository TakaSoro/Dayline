export interface Journal {
  id: number;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface JournalSummary {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
  preview: string;
}

export interface Activity {
  id: number; // unused in ts
  journal_id: number;
  description: string;
  category: string;
  activity_date: string;
}

export interface TimelineDay {
  date: string;
  activities: Activity[];
}

export type View = "journal" | "timeline" | "settings";
