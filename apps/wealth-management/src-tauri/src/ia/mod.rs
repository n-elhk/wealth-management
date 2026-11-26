//! IA locale pour l'import de documents (desktop uniquement).
//!
//! Rust ne fait que de l'outillage : extraction du texte (xberg), téléchargement du modèle
//! et génération de texte (Candle). Les prompts, le schéma attendu et la validation (zod)
//! restent côté TypeScript (`@wealth-management/core`, module `import`).
//!
//! Aucun serveur HTTP : tout passe par des commandes Tauri. La seule connexion réseau est
//! le téléchargement initial du modèle ; l'analyse fonctionne ensuite hors ligne.
//!
//! Les commandes synchrones (`ia_etat`, `ia_annuler`, `ia_decharger`) s'exécutent sur le thread
//! principal : elles ne doivent jamais attendre le verrou du modèle, tenu pendant toute une analyse.

mod extraction;
mod llm;
mod telechargement;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError, TryLockError};

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_fs::FsExt;
use tokenizers::Tokenizer;

use llm::{Etape, Llm};
use telechargement::{est_installe, ProgressionTelechargement, DOSSIER_OCR, LANGAGE, OCR};

/// État partagé : modèle chargé à la demande (≈ 5 Go en mémoire), tokenizer partagé et drapeaux.
#[derive(Default)]
pub struct Ia {
    modele: Arc<Mutex<Option<Llm>>>,
    tokenizer: Arc<Mutex<Option<Arc<Tokenizer>>>>,
    annulation: Arc<AtomicBool>,
    occupe: Arc<AtomicBool>,
}

/// Empêche deux opérations longues simultanées (téléchargement, analyse, déchargement) ;
/// libéré à la destruction.
///
/// `prendre` ne remet pas le drapeau d'annulation à zéro : une analyse enchaîne plusieurs
/// commandes (extraction, comptage, génération) et un « Annuler » cliqué avant la génération
/// doit l'empêcher de démarrer. Le drapeau est remis à zéro au début de chaque opération
/// (`ia_nouvelle_analyse`, `ia_telecharger`).
struct Occupation(Arc<AtomicBool>);

const OCCUPEE: &str = "Une autre opération d'IA est déjà en cours.";

impl Occupation {
    fn prendre(ia: &Ia) -> Result<Self, String> {
        if ia.occupe.swap(true, Ordering::AcqRel) {
            return Err(OCCUPEE.into());
        }
        Ok(Self(ia.occupe.clone()))
    }
}

impl Drop for Occupation {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

/// Un verrou empoisonné (panique en debug ; `panic = "abort"` en release) ne doit pas rendre
/// l'IA inutilisable jusqu'au redémarrage : l'état protégé reste cohérent (le cache KV est
/// vidé au début de chaque génération).
fn verrouiller<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

fn dossier_modele(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|d| d.join("modeles"))
        .map_err(|e| format!("Dossier de données introuvable : {e}"))
}

fn langage_installe(dossier: &Path) -> bool {
    est_installe(dossier, &LANGAGE)
}

/// Tokenizer chargé une seule fois, partagé entre le comptage de tokens et le modèle.
fn tokenizer(cache: &Mutex<Option<Arc<Tokenizer>>>, dossier: &Path) -> Result<Arc<Tokenizer>, String> {
    let mut t = verrouiller(cache);
    if let Some(t) = t.as_ref() {
        return Ok(Arc::clone(t));
    }
    let charge = Arc::new(llm::charger_tokenizer(dossier)?);
    *t = Some(Arc::clone(&charge));
    Ok(charge)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EtatIa {
    installe: bool,
    /// Modèle en mémoire (ou en cours de chargement).
    charge: bool,
    taille_totale: u64,
    contexte: usize,
    /// Modèle d'OCR (facultatif) : lecture des PDF scannés ou dont le texte est dessiné.
    ocr_installe: bool,
    /// Taille estimée du modèle d'OCR, pour l'affichage avant téléchargement.
    taille_ocr: u64,
}

/// Modèle à télécharger (`ia_telecharger`).
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ModeleATelecharger {
    Langage,
    Ocr,
}

#[tauri::command]
pub fn ia_etat(app: AppHandle, ia: State<'_, Ia>) -> Result<EtatIa, String> {
    let dossier = dossier_modele(&app)?;
    let charge = match ia.modele.try_lock() {
        Ok(m) => m.is_some(),
        // Verrou tenu par une analyse : le modèle est chargé ou en cours de chargement.
        Err(TryLockError::WouldBlock) => true,
        Err(TryLockError::Poisoned(e)) => e.into_inner().is_some(),
    };
    Ok(EtatIa {
        installe: langage_installe(&dossier),
        charge,
        taille_totale: LANGAGE.taille_affichee,
        contexte: llm::CONTEXTE,
        ocr_installe: est_installe(&dossier, &OCR),
        taille_ocr: OCR.taille_affichee,
    })
}

#[tauri::command]
pub async fn ia_telecharger(
    app: AppHandle,
    ia: State<'_, Ia>,
    modele: ModeleATelecharger,
    canal: Channel<ProgressionTelechargement>,
) -> Result<(), String> {
    let _occupation = Occupation::prendre(&ia)?;
    ia.annulation.store(false, Ordering::Relaxed);
    let dossier = dossier_modele(&app)?;
    let modele = match modele {
        ModeleATelecharger::Langage => &LANGAGE,
        ModeleATelecharger::Ocr => &OCR,
    };
    telechargement::telecharger(&dossier, modele, &ia.annulation, |p| {
        let _ = canal.send(p);
    })
    .await
}

/// Début d'une analyse de document (avant l'extraction du texte) : remet le drapeau d'annulation
/// à zéro. Une annulation demandée ensuite, à n'importe quelle étape, empêche la génération.
#[tauri::command]
pub fn ia_nouvelle_analyse(ia: State<'_, Ia>) -> Result<(), String> {
    if ia.occupe.load(Ordering::Acquire) {
        return Err(OCCUPEE.into());
    }
    ia.annulation.store(false, Ordering::Relaxed);
    Ok(())
}

/// Interrompt le téléchargement ou l'analyse en cours (y compris une analyse pas encore en génération).
#[tauri::command]
pub fn ia_annuler(ia: State<'_, Ia>) {
    ia.annulation.store(true, Ordering::Relaxed);
}

/// Libère la mémoire occupée par le modèle (refusé pendant une analyse ou un téléchargement).
#[tauri::command]
pub fn ia_decharger(ia: State<'_, Ia>) -> Result<(), String> {
    // L'occupation garantit qu'aucune analyse ne tient le verrou : `verrouiller` n'attend pas.
    let _occupation = Occupation::prendre(&ia)?;
    verrouiller(&ia.modele).take();
    Ok(())
}

/// Texte d'un document choisi dans la boîte de dialogue.
#[tauri::command]
pub async fn ia_extraire_texte(app: AppHandle, chemin: PathBuf) -> Result<String, String> {
    // Le plugin dialog ajoute au scope fs les fichiers choisis par l'utilisateur : le webview
    // ne peut pas faire lire un autre fichier du disque.
    if !app.fs_scope().is_allowed(&chemin) {
        return Err("Accès refusé : choisissez le document avec la boîte de dialogue.".into());
    }
    let dossier = dossier_modele(&app)?;
    let ocr = est_installe(&dossier, &OCR).then(|| dossier.join(DOSSIER_OCR));
    extraction::extraire_texte(&chemin, ocr.as_deref()).await
}

/// Nombre de tokens du texte (tokenizer seul, sans charger le modèle) : sert à calibrer le prompt.
#[tauri::command]
pub async fn ia_compter_tokens(app: AppHandle, ia: State<'_, Ia>, texte: String) -> Result<usize, String> {
    let dossier = dossier_modele(&app)?;
    let cache = Arc::clone(&ia.tokenizer);
    tauri::async_runtime::spawn_blocking(move || {
        let tokenizer = tokenizer(&cache, &dossier)?;
        llm::compter_tokens(&tokenizer, &texte)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Clone, Serialize)]
#[serde(tag = "etape", rename_all = "camelCase")]
pub enum ProgressionGeneration {
    Chargement,
    Prompt { traite: usize, total: usize },
    Generation { tokens: usize, max: usize },
}

/// Génère la réponse du modèle au prompt ; le modèle est chargé au premier appel puis conservé.
#[tauri::command]
pub async fn ia_generer(
    app: AppHandle,
    ia: State<'_, Ia>,
    prompt: String,
    max_tokens: usize,
    canal: Channel<ProgressionGeneration>,
) -> Result<String, String> {
    let occupation = Occupation::prendre(&ia)?;
    let dossier = dossier_modele(&app)?;
    if !langage_installe(&dossier) {
        return Err("Le modèle n'est pas installé.".into());
    }
    let modele = Arc::clone(&ia.modele);
    let cache_tokenizer = Arc::clone(&ia.tokenizer);
    let annulation = Arc::clone(&ia.annulation);
    tauri::async_runtime::spawn_blocking(move || {
        // Déclarée avant le verrou : libérée après lui (ordre de destruction inverse).
        let _occupation = occupation;
        let mut verrou = verrouiller(&modele);
        if verrou.is_none() {
            let _ = canal.send(ProgressionGeneration::Chargement);
            *verrou = Some(Llm::charger(&dossier, tokenizer(&cache_tokenizer, &dossier)?)?);
        }
        let llm = verrou.as_mut().expect("modèle chargé juste au-dessus");
        llm.generer(&prompt, max_tokens, &annulation, |etape| {
            let _ = canal.send(match etape {
                Etape::Prompt { traite, total } => ProgressionGeneration::Prompt { traite, total },
                Etape::Generation { tokens } => ProgressionGeneration::Generation { tokens, max: max_tokens },
            });
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
