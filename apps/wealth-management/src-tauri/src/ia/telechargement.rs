//! Téléchargement unique des modèles depuis Hugging Face, à la demande de l'utilisateur
//! (paramètres) : modèle de langage (Mistral) et, facultatif, modèle d'OCR (PaddleOCR-VL).
//!
//! Les URL sont figées sur un commit précis et chaque fichier est vérifié par SHA-256 :
//! un fichier corrompu ou substitué est refusé. Un téléchargement interrompu reprend
//! là où il s'était arrêté (fichier `.part` + requête `Range`). Un fichier n'est installé
//! (renommé) qu'une fois son empreinte vérifiée.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use futures_util::StreamExt;
use reqwest::header::{CONTENT_RANGE, RANGE};
use reqwest::StatusCode;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub struct FichierModele {
    /// Chemin relatif au dossier des modèles.
    pub nom: &'static str,
    url: &'static str,
    sha256: &'static str,
    /// Taille exacte quand elle est connue ; sinon seule l'empreinte fait foi, et la progression
    /// utilise la taille annoncée par le serveur.
    pub taille: Option<u64>,
}

/// Ensemble de fichiers téléchargés et installés ensemble.
pub struct Modele {
    pub fichiers: &'static [&'static FichierModele],
    /// Taille affichée à l'utilisateur avant téléchargement (estimation si des tailles sont inconnues).
    pub taille_affichee: u64,
}

/// Mistral 7B Instruct v0.3, quantifié Q5_K_M (GGUF, dépôt bartowski).
pub const GGUF: FichierModele = FichierModele {
    nom: "Mistral-7B-Instruct-v0.3-Q5_K_M.gguf",
    url: "https://huggingface.co/bartowski/Mistral-7B-Instruct-v0.3-GGUF/resolve/61fd4167fff3ab01ee1cfe0da183fa27a944db48/Mistral-7B-Instruct-v0.3-Q5_K_M.gguf",
    sha256: "0374072546aaf1257d1e34610edb11b691730d8ef7d44b5629693a2dd8e8d472",
    taille: Some(5_136_175_328),
};

/// Tokenizer officiel de Mistral 7B Instruct v0.3 (vocabulaire de 32 768 tokens).
pub const TOKENIZER: FichierModele = FichierModele {
    nom: "tokenizer.json",
    url: "https://huggingface.co/mistralai/Mistral-7B-Instruct-v0.3/resolve/c170c708c41dac9275d15a8fff4eca08d52bab71/tokenizer.json",
    sha256: "e553af6fff7d7ad76e830608b218c5c0b0822998d5a1a96099a74cd3c1cb1a49",
    taille: Some(1_961_548),
};

/// Modèle de langage : lit le texte des documents et en extrait les informations.
pub const LANGAGE: Modele = Modele { fichiers: &[&TOKENIZER, &GGUF], taille_affichee: 5_138_136_876 };

/// Sous-dossier du modèle d'OCR, passé à xberg (`model_path`) : il ne télécharge alors rien lui-même.
pub const DOSSIER_OCR: &str = "paddleocr-vl-1.6";

/// PaddleOCR-VL 1.6 (Apache-2.0), miroir à l'identique publié par xberg (`xberg-io/paddleocr-vl-1.6`),
/// au commit et aux empreintes figés par xberg 1.5.4 (`src/candle_ocr/paddleocr-vl-1.6.sha256`).
/// Tailles non renseignées : l'empreinte suffit à garantir l'intégrité.
macro_rules! fichier_ocr {
    ($nom:literal, $sha256:literal) => {
        FichierModele {
            nom: concat!("paddleocr-vl-1.6/", $nom),
            url: concat!(
                "https://huggingface.co/xberg-io/paddleocr-vl-1.6/resolve/2ce18e126792e5e5e806553ff4fa84f3684c2c34/",
                $nom
            ),
            sha256: $sha256,
            taille: None,
        }
    };
}
const OCR_CONFIG: FichierModele = fichier_ocr!("config.json", "ce7f4565f8b1db78532ad5d1b9ebe55c2139d49bd4cb04778b580a08a598f171");
const OCR_PREPROCESSEUR: FichierModele =
    fichier_ocr!("preprocessor_config.json", "111872ab1e8bb7fd040ac5087bfced7ab8f011f02139b088cba294964c3b1d0e");
const OCR_TOKENIZER: FichierModele = fichier_ocr!("tokenizer.json", "c8a215a59183d0d0781adc33bacd3ce6162716f7fd568fb30234a74d69803a7d");
const OCR_GENERATION: FichierModele =
    fichier_ocr!("generation_config.json", "a6701d78ab3b4d972307cdec3b69d4c13f46e0d5140514f50ab7d84259324b94");
const OCR_POIDS: FichierModele = fichier_ocr!("model.safetensors", "85a479d506a11e724e7285d395c551be69f41dbc16b6342d3cacfb189aed71db");

/// Modèle d'OCR (facultatif) : reconnaît le texte des PDF scannés ou vectorisés.
pub const OCR: Modele = Modele {
    fichiers: &[&OCR_CONFIG, &OCR_PREPROCESSEUR, &OCR_TOKENIZER, &OCR_GENERATION, &OCR_POIDS],
    // Estimation (≈ 0,9 milliard de paramètres en bf16) : la taille réelle s'affiche au téléchargement.
    taille_affichee: 1_900_000_000,
};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressionTelechargement {
    pub fichier: &'static str,
    pub recu: u64,
    pub total: u64,
}

/// Un fichier est considéré installé s'il existe (il n'est renommé qu'après vérification de son
/// empreinte) et, quand elle est connue, s'il a la taille attendue.
pub fn est_present(dossier: &Path, f: &FichierModele) -> bool {
    std::fs::metadata(dossier.join(f.nom)).is_ok_and(|m| f.taille.is_none_or(|t| m.len() == t))
}

pub fn est_installe(dossier: &Path, modele: &Modele) -> bool {
    modele.fichiers.iter().all(|f| est_present(dossier, f))
}

/// Délai maximal d'établissement de la connexion.
const DELAI_CONNEXION: Duration = Duration::from_secs(30);
/// Sans aucune donnée reçue pendant ce délai, la connexion est considérée perdue.
const DELAI_INACTIVITE: Duration = Duration::from_secs(60);
/// Fréquence de vérification de l'annulation quand le réseau ne livre rien.
const INTERVALLE_ANNULATION: Duration = Duration::from_millis(250);

const INTERROMPU: &str = "Téléchargement interrompu (il reprendra au prochain essai).";

pub async fn telecharger(
    dossier: &Path,
    modele: &Modele,
    annulation: &AtomicBool,
    mut progression: impl FnMut(ProgressionTelechargement),
) -> Result<(), String> {
    tokio::fs::create_dir_all(dossier)
        .await
        .map_err(|e| format!("Impossible de créer le dossier du modèle : {e}"))?;
    let client = reqwest::Client::builder()
        .user_agent("wealth-management")
        .connect_timeout(DELAI_CONNEXION)
        .read_timeout(DELAI_INACTIVITE)
        .build()
        .map_err(|e| e.to_string())?;
    for f in modele.fichiers {
        if !est_present(dossier, f) {
            telecharger_fichier(&client, dossier, f, annulation, &mut progression).await?;
        }
    }
    Ok(())
}

/// Reprise : ré-hache ce qui a déjà été reçu dans le fichier `.part` (absent → rien de reçu).
async fn relire_partiel(partiel: &Path, f: &FichierModele) -> Result<(Sha256, u64), String> {
    let mut hash = Sha256::new();
    let Ok(mut existant) = tokio::fs::File::open(partiel).await else {
        return Ok((hash, 0));
    };
    let mut tampon = vec![0u8; 1 << 20];
    let mut recu = 0u64;
    loop {
        let n = existant
            .read(&mut tampon)
            .await
            .map_err(|e| format!("Lecture impossible ({}) : {e}", f.nom))?;
        if n == 0 {
            break;
        }
        hash.update(&tampon[..n]);
        recu += n as u64;
    }
    if f.taille.is_some_and(|t| recu > t) {
        // Plus long que le fichier attendu : inutilisable.
        return Ok((Sha256::new(), 0));
    }
    Ok((hash, recu))
}

async fn envoyer(client: &reqwest::Client, f: &FichierModele, depuis: u64) -> Result<reqwest::Response, String> {
    let mut requete = client.get(f.url);
    if depuis > 0 {
        requete = requete.header(RANGE, format!("bytes={depuis}-"));
    }
    requete
        .send()
        .await
        .map_err(|e| format!("Téléchargement impossible ({}) : {e}", f.nom))
}

/// Taille totale du fichier annoncée par le serveur (`Content-Range: …/<total>` pour une reprise).
fn taille_annoncee(reponse: &reqwest::Response) -> Option<u64> {
    if reponse.status() == StatusCode::PARTIAL_CONTENT {
        reponse.headers().get(CONTENT_RANGE)?.to_str().ok()?.rsplit('/').next()?.parse().ok()
    } else {
        reponse.content_length()
    }
}

/// Début de la plage renvoyée (`Content-Range: bytes <début>-<fin>/<total>`).
fn debut_plage(reponse: &reqwest::Response) -> Option<u64> {
    reponse
        .headers()
        .get(CONTENT_RANGE)?
        .to_str()
        .ok()?
        .strip_prefix("bytes ")?
        .split('-')
        .next()?
        .parse()
        .ok()
}

async fn telecharger_fichier(
    client: &reqwest::Client,
    dossier: &Path,
    f: &FichierModele,
    annulation: &AtomicBool,
    progression: &mut impl FnMut(ProgressionTelechargement),
) -> Result<(), String> {
    let installe = dossier.join(f.nom);
    if let Some(parent) = installe.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Impossible de créer le dossier du modèle : {e}"))?;
    }
    let partiel: PathBuf = dossier.join(format!("{}.part", f.nom));
    let (mut hash, mut recu) = relire_partiel(&partiel, f).await?;

    // `.part` déjà complet (app fermée avant l'installation) : rien à demander au serveur,
    // une requête `Range` au-delà de la fin obtiendrait un 416.
    if f.taille.is_none_or(|t| recu < t) {
        recevoir(client, &partiel, f, annulation, progression, &mut hash, &mut recu).await?;
    }

    let empreinte = hex::encode(hash.finalize());
    if f.taille.is_some_and(|t| recu != t) || empreinte != f.sha256 {
        let _ = tokio::fs::remove_file(&partiel).await;
        return Err(format!("Fichier {} corrompu (empreinte SHA-256 inattendue) : relancez le téléchargement.", f.nom));
    }
    tokio::fs::rename(&partiel, &installe)
        .await
        .map_err(|e| format!("Installation impossible ({}) : {e}", f.nom))?;
    progression(ProgressionTelechargement { fichier: f.nom, recu, total: recu });
    Ok(())
}

/// Télécharge la suite du fichier dans `partiel`, en mettant à jour `hash` et `recu`.
async fn recevoir(
    client: &reqwest::Client,
    partiel: &Path,
    f: &FichierModele,
    annulation: &AtomicBool,
    progression: &mut impl FnMut(ProgressionTelechargement),
    hash: &mut Sha256,
    recu: &mut u64,
) -> Result<(), String> {
    let erreur_es = |e: std::io::Error| format!("Erreur d'écriture ({}) : {e}", f.nom);

    let mut reponse = envoyer(client, f, *recu).await?;
    if *recu > 0 && reponse.status() == StatusCode::RANGE_NOT_SATISFIABLE {
        // Rien après `recu` : le `.part` est sans doute complet (taille inconnue à l'avance).
        // L'empreinte tranchera ; s'il est corrompu, il sera supprimé et retéléchargé.
        return Ok(());
    }
    if *recu > 0 {
        let reprise_acceptee =
            reponse.status() == StatusCode::PARTIAL_CONTENT && debut_plage(&reponse) == Some(*recu);
        if !reprise_acceptee {
            // Reprise ignorée (200 : le corps est le fichier entier) ou incohérente (plage
            // décalée) : on repart de zéro.
            *recu = 0;
            *hash = Sha256::new();
            if reponse.status() != StatusCode::OK {
                reponse = envoyer(client, f, 0).await?;
            }
        }
    }
    let statut = reponse.status();
    if !statut.is_success() {
        return Err(format!("Téléchargement refusé ({}) : HTTP {statut}", f.nom));
    }

    let mut sortie = tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(*recu > 0)
        .truncate(*recu == 0)
        .open(partiel)
        .await
        .map_err(erreur_es)?;

    let total = f.taille.or_else(|| taille_annoncee(&reponse)).unwrap_or(0);
    let pas = (total / 200).max(1 << 20);
    let mut dernier_signal = *recu;
    progression(ProgressionTelechargement { fichier: f.nom, recu: *recu, total });

    let mut flux = reponse.bytes_stream();
    loop {
        if annulation.load(Ordering::Relaxed) {
            sortie.flush().await.map_err(erreur_es)?;
            return Err(INTERROMPU.into());
        }
        // Attente bornée : l'annulation reste prise en compte même si le réseau ne livre plus
        // rien (`StreamExt::next` peut être abandonné sans perte). Une connexion muette au-delà
        // de `DELAI_INACTIVITE` est coupée par reqwest et remonte en erreur.
        let Ok(suivant) = tokio::time::timeout(INTERVALLE_ANNULATION, flux.next()).await else {
            continue;
        };
        let Some(morceau) = suivant else {
            break;
        };
        let morceau = morceau.map_err(|e| format!("Connexion interrompue ({}) : {e}", f.nom))?;
        hash.update(&morceau);
        sortie.write_all(&morceau).await.map_err(erreur_es)?;
        *recu += morceau.len() as u64;
        if *recu - dernier_signal >= pas {
            dernier_signal = *recu;
            progression(ProgressionTelechargement { fichier: f.nom, recu: *recu, total });
        }
    }
    sortie.flush().await.map_err(erreur_es)
}
