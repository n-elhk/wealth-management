//! Extraction du contenu d'un document avec xberg (backend PDF 100 % Rust, tableurs via calamine).
//! Le contenu est rendu en Markdown : les tableaux restent lisibles par le modèle.
//!
//! PDF sans texte (scanné, ou texte vectorisé) : si le modèle d'OCR a été téléchargé (paramètres),
//! xberg dessine les pages et en reconnaît le texte avec PaddleOCR-VL (Candle, sur CPU), à partir
//! du dossier local (`model_path`) : il ne télécharge jamais rien lui-même.

use std::path::Path;

use xberg::{ExtractInput, ExtractionConfig, ImageExtractionConfig, OcrConfig, OutputFormat};

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
}

/// Lecture du texte natif uniquement (rapide, sans OCR).
fn config_texte(format: OutputFormat) -> ExtractionConfig {
    ExtractionConfig { output_format: format, disable_ocr: true, ..Default::default() }
}

/// Résolution maximale des pages dessinées pour l'OCR. Par défaut xberg peut monter à 300 DPI ;
/// la mémoire du modèle de vision croît avec le nombre de pixels. 150 DPI au plus, et 1 400 px sur
/// le plus grand côté (≈ 120 DPI pour une page A4) : un texte de 10 pt reste lisible.
const OCR_DPI_MAX: i32 = 150;
const OCR_DIMENSION_MAX: i32 = 1400;

/// OCR forcé de toutes les pages avec PaddleOCR-VL, depuis les fichiers téléchargés dans `dossier_ocr`.
fn config_ocr(dossier_ocr: &Path) -> ExtractionConfig {
    ExtractionConfig {
        output_format: OutputFormat::Markdown,
        force_ocr: true,
        images: Some(ImageExtractionConfig {
            target_dpi: OCR_DPI_MAX,
            max_dpi: OCR_DPI_MAX,
            max_image_dimension: OCR_DIMENSION_MAX,
            auto_adjust_dpi: true,
            ..Default::default()
        }),
        ocr: Some(OcrConfig {
            backend: "candle-paddleocr-vl".into(),
            language: vec!["fra".into()],
            backend_options: Some(serde_json::json!({
                "task": "ocr",
                "device": "cpu",
                "model_path": dossier_ocr,
            })),
            ..Default::default()
        }),
        ..Default::default()
    }
}

async fn tenter(octets: Vec<u8>, mime: &'static str, nom: Option<String>, config: ExtractionConfig) -> Result<Tentative, String> {
    // Lecture depuis les octets (et non depuis une URI) : xberg ne va jamais chercher de ressource externe.
    let resultat = xberg::extract(ExtractInput::from_bytes(octets, mime, nom), &config)
        .await
        .map_err(|e| format!("Extraction impossible : {e}"))?;
    let erreurs = resultat.errors.into_iter().map(|e| e.message).collect();
    let pages = resultat.results.iter().map(|d| d.counts.pages).sum();
    let texte = resultat.results.into_iter().map(|d| d.content).collect::<Vec<_>>().join("\n\n");
    Ok(Tentative { texte, erreurs, pages })
}

/// Texte du document ; `dossier_ocr` est le dossier du modèle d'OCR s'il est installé.
/// `avant_ocr` est appelé juste avant l'OCR (seulement s'il a lieu) : libération du modèle de langage.
pub async fn extraire_texte(
    chemin: &Path,
    dossier_ocr: Option<&Path>,
    avant_ocr: impl FnOnce(),
) -> Result<String, String> {
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
    let markdown = tenter(octets.clone(), mime, nom.clone(), config_texte(OutputFormat::Markdown)).await?;
    if !markdown.texte.trim().is_empty() {
        return Ok(markdown.texte);
    }
    let brut = tenter(octets.clone(), mime, nom.clone(), config_texte(OutputFormat::Plain)).await?;
    if !brut.texte.trim().is_empty() {
        return Ok(brut.texte);
    }

    let mut erreurs = markdown.erreurs;
    erreurs.extend(brut.erreurs);

    // Aucun texte natif : OCR si le modèle est installé (seulement pour les PDF).
    let ocr_possible = mime == "application/pdf";
    if let (true, Some(dossier)) = (ocr_possible, dossier_ocr) {
        avant_ocr();
        let ocr = tenter(octets, mime, nom, config_ocr(dossier)).await?;
        if !ocr.texte.trim().is_empty() {
            return Ok(ocr.texte);
        }
        erreurs.extend(ocr.erreurs);
    }

    erreurs.dedup();
    Err(if !erreurs.is_empty() {
        format!("Extraction impossible : {}", erreurs.join(" ; "))
    } else if ocr_possible && dossier_ocr.is_none() {
        format!(
            "Ce document ne contient pas de texte lisible ({} page(s)) : c'est un PDF scanné ou dont le texte est \
             dessiné. Téléchargez la lecture des PDF scannés (OCR) dans les paramètres, puis réessayez.",
            brut.pages
        )
    } else if ocr_possible {
        format!("Aucun texte n'a pu être reconnu dans ce document ({} page(s)), même par l'OCR.", brut.pages)
    } else {
        "Aucun texte trouvé dans ce document.".into()
    })
}
