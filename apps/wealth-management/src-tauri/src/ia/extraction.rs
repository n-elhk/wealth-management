//! Extraction du contenu d'un document avec xberg (backend PDF 100 % Rust, tableurs via calamine).
//! Le contenu est rendu en Markdown : les tableaux restent lisibles par le modèle.

use std::path::Path;

use xberg::{ExtractInput, ExtractionConfig, OutputFormat};

/// Formats acceptés : la commande ne lit pas d'autres fichiers.
fn type_mime(chemin: &Path) -> Option<&'static str> {
    let extension = chemin.extension()?.to_str()?.to_ascii_lowercase();
    Some(match extension.as_str() {
        "pdf" => "application/pdf",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "xls" => "application/vnd.ms-excel",
        "ods" => "application/vnd.oasis.opendocument.spreadsheet",
        _ => return None,
    })
}

/// Taille maximale lue (un bail fait quelques centaines de Ko).
const TAILLE_MAX: u64 = 50 * 1024 * 1024;

pub async fn extraire_texte(chemin: &Path) -> Result<String, String> {
    let mime = type_mime(chemin).ok_or("Format non pris en charge (PDF, XLSX, XLS ou ODS attendu).")?;
    let taille = tokio::fs::metadata(chemin)
        .await
        .map_err(|e| format!("Fichier illisible : {e}"))?
        .len();
    if taille > TAILLE_MAX {
        return Err("Fichier trop volumineux (50 Mo maximum).".into());
    }
    let octets = tokio::fs::read(chemin).await.map_err(|e| format!("Fichier illisible : {e}"))?;
    let nom = chemin.file_name().and_then(|n| n.to_str()).map(str::to_owned);

    let config = ExtractionConfig { output_format: OutputFormat::Markdown, ..Default::default() };
    // Lecture depuis les octets (et non depuis une URI) : xberg ne va jamais chercher de ressource externe.
    let resultat = xberg::extract(ExtractInput::from_bytes(octets, mime, nom), &config)
        .await
        .map_err(|e| format!("Extraction impossible : {e}"))?;
    let texte = resultat
        .results
        .into_iter()
        .map(|d| d.content)
        .collect::<Vec<_>>()
        .join("\n\n");
    if texte.trim().is_empty() {
        return Err(
            "Aucun texte trouvé dans ce document (PDF scanné ?). Seuls les documents contenant du texte sont pris en charge."
                .into(),
        );
    }
    Ok(texte)
}
