mod db;
mod gemini;
mod models;

use db::Database;
use models::{Activity, Journal, JournalSummary, TimelineDay};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::Manager;

struct AppState {
    db: Arc<Database>,
    app_data_dir: PathBuf,
}

#[tauri::command]
fn create_journal(
    state: tauri::State<'_, AppState>,
    title: String,
    content: String,
) -> Result<Journal, String> {
    state.db.create_journal(title, content)
}

#[tauri::command]
fn update_journal(
    state: tauri::State<'_, AppState>,
    id: i64,
    title: String,
    content: String,
) -> Result<Journal, String> {
    state.db.update_journal(id, title, content)
}

#[tauri::command]
fn delete_journal(state: tauri::State<'_, AppState>, id: i64) -> Result<(), String> {
    state.db.delete_journal(id)
}

#[tauri::command]
fn get_journal(state: tauri::State<'_, AppState>, id: i64) -> Result<Journal, String> {
    state.db.get_journal(id)
}

#[tauri::command]
fn list_journals(state: tauri::State<'_, AppState>) -> Result<Vec<JournalSummary>, String> {
    state.db.list_journals()
}

#[tauri::command]
async fn analyze_journal(
    state: tauri::State<'_, AppState>,
    id: i64,
) -> Result<Vec<Activity>, String> {
    let api_key = state
        .db
        .get_setting("gemini_api_key")?
        .ok_or("Gemini API key not configured. Add it in Settings.")?;

    let journal = state.db.get_journal(id)?;
    let activities = gemini::analyze_journal(&api_key, &journal.title, &journal.content).await?;

    let activity_date = journal.created_at.chars().take(10).collect::<String>();
    let pairs: Vec<(String, String)> = activities
        .iter()
        .map(|a| (a.description.clone(), a.category.clone()))
        .collect();

    state
        .db
        .replace_activities(id, &activity_date, &pairs)
}

#[tauri::command]
fn get_journal_activities(
    state: tauri::State<'_, AppState>,
    journal_id: i64,
) -> Result<Vec<Activity>, String> {
    state.db.get_activities_for_journal(journal_id)
}

#[tauri::command]
fn get_timeline(
    state: tauri::State<'_, AppState>,
    category: Option<String>,
) -> Result<Vec<TimelineDay>, String> {
    state.db.get_timeline(category)
}

#[tauri::command]
fn get_categories(state: tauri::State<'_, AppState>) -> Result<Vec<String>, String> {
    state.db.get_categories()
}

#[tauri::command]
fn set_gemini_api_key(state: tauri::State<'_, AppState>, key: String) -> Result<(), String> {
    state.db.set_setting("gemini_api_key", &key)
}

#[tauri::command]
fn has_gemini_api_key(state: tauri::State<'_, AppState>) -> Result<bool, String> {
    Ok(state.db.get_setting("gemini_api_key")?.is_some())
}

#[tauri::command]
fn import_journal_image(
    state: tauri::State<'_, AppState>,
    source_path: String,
) -> Result<String, String> {
    let images_dir = state.app_data_dir.join("images");
    std::fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;

    let source = std::path::Path::new(&source_path);
    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png");

    let unique_name = format!("{}.{}", uuid::Uuid::new_v4(), ext);
    let dest_path = images_dir.join(&unique_name);

    std::fs::copy(source, &dest_path).map_err(|e| format!("Failed to copy image: {e}"))?;
    Ok(dest_path.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| e.to_string())?;
            let db = Database::new(app_data_dir.clone()).map_err(|e| e.to_string())?;
            app.manage(AppState {
                db: Arc::new(db),
                app_data_dir,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_journal,
            update_journal,
            delete_journal,
            get_journal,
            list_journals,
            analyze_journal,
            get_journal_activities,
            get_timeline,
            get_categories,
            set_gemini_api_key,
            has_gemini_api_key,
            import_journal_image,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
