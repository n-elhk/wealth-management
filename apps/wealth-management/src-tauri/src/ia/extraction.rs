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

/// Résultat d'une tentative d'extraction, avec de quoi expliquer un texte vide.
struct Tentative {
    texte: String,
    /// Erreurs non bloquantes signalées par xberg (sans elles, un échec ressemble à un document vide).
    erreurs: Vec<String>,
    pages: usize,
    images: usize,
}

async fn tenter(octets: Vec<u8>, mime: &'static str, nom: Option<String>, format: OutputFormat) -> Result<Tentative, String> {
    let config = ExtractionConfig { output_format: format, ..Default::default() };
    // Lecture depuis les octets (et non depuis une URI) : xberg ne va jamais chercher de ressource externe.
    let resultat = xberg::extract(ExtractInput::from_bytes(octets, mime, nom), &config)
        .await
        .map_err(|e| format!("Extraction impossible : {e}"))?;
    let erreurs = resultat.errors.into_iter().map(|e| e.message).collect();
    let pages = resultat.results.iter().map(|d| d.counts.pages).sum();
    let images = resultat.results.iter().map(|d| d.counts.images).sum();
    let texte = resultat.results.into_iter().map(|d| d.content).collect::<Vec<_>>().join("\n\n");
    Ok(Tentative { texte, erreurs, pages, images })
}

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

    // Markdown d'abord (tableaux lisibles par le modèle) ; selon la mise en page, ce rendu peut
    // perdre le texte : second essai en texte brut avant de conclure à un document sans texte.
    let markdown = tenter(octets.clone(), mime, nom.clone(), OutputFormat::Markdown).await?;
    if !markdown.texte.trim().is_empty() {
        return Ok(markdown.texte);
    }
    let brut = tenter(octets, mime, nom, OutputFormat::Plain).await?;
    if !brut.texte.trim().is_empty() {
        return Ok(brut.texte);
    }

    let mut erreurs = markdown.erreurs;
    erreurs.extend(brut.erreurs);
    erreurs.dedup();
    Err(if !erreurs.is_empty() {
        format!("Extraction impossible : {}", erreurs.join(" ; "))
    } else if brut.images > 0 {
        format!(
            "Aucun texte trouvé dans ce document ({} page(s), {} image(s)) : c'est probablement un PDF scanné. \
             Seuls les documents contenant du texte sont pris en charge.",
            brut.pages, brut.images
        )
    } else {
        format!(
            "Aucun texte n'a pu être lu dans ce document ({} page(s)). Son texte est peut-être encodé d'une façon \
             non prise en charge : essayez de le réenregistrer en PDF (« Imprimer » → « Enregistrer en PDF »).",
            brut.pages
        )
    })
}
