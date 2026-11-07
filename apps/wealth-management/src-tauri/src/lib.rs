//! Point d'entrée commun desktop / mobile.
//!
//! Toute la logique métier vit côté TypeScript (`@wealth-management/core`, `@wealth-management/db`) ;
//! Rust se contente d'exposer SQLite, les boîtes de dialogue et le système de fichiers.
//! Le schéma est migré au démarrage par `@wealth-management/db` (table `_migrations`).

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("erreur au lancement de Wealth Management");
}
