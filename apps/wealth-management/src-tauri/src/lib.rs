//! Point d'entrée commun desktop / mobile.
//!
//! Toute la logique métier vit côté TypeScript (`@wealth-management/core`, `@wealth-management/db`) ;
//! Rust se contente d'exposer SQLite, les boîtes de dialogue et le système de fichiers.
//! Le schéma est migré au démarrage par `@wealth-management/db` (table `_migrations`).
//!
//! Exception, sur desktop uniquement : le module `ia` (extraction de documents avec xberg et
//! modèle de langage local avec Candle) pour l'import de documents — voir `ia/mod.rs`.

#[cfg(desktop)]
mod ia;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init());

    #[cfg(desktop)]
    let builder = builder.manage(ia::Ia::default()).invoke_handler(tauri::generate_handler![
        ia::ia_etat,
        ia::ia_telecharger,
        ia::ia_nouvelle_analyse,
        ia::ia_annuler,
        ia::ia_decharger,
        ia::ia_extraire_texte,
        ia::ia_compter_tokens,
        ia::ia_generer,
    ]);

    builder
        .run(tauri::generate_context!())
        .expect("erreur au lancement de Wealth Management");
}
