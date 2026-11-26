//! Téléchargement unique des fichiers du modèle depuis Hugging Face.
//!
//! Les URL sont figées sur un commit précis et chaque fichier est vérifié par SHA-256 :
//! un fichier corrompu ou substitué est refusé. Un téléchargement interrompu reprend
//! là où il s'était arrêté (fichier `.part` + requête `Range`).

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
    pub nom: &'static str,
    url: &'static str,
    sha256: &'static str,
    pub taille: u64,
}

/// Mistral 7B Instruct v0.3, quantifié Q5_K_M (GGUF, dépôt bartowski).
pub const GGUF: FichierModele = FichierModele {
    nom: "Mistral-7B-Instruct-v0.3-Q5_K_M.gguf",
    url: "https://huggingface.co/bartowski/Mistral-7B-Instruct-v0.3-GGUF/resolve/61fd4167fff3ab01ee1cfe0da183fa27a944db48/Mistral-7B-Instruct-v0.3-Q5_K_M.gguf",
    sha256: "0374072546aaf1257d1e34610edb11b691730d8ef7d44b5629693a2dd8e8d472",
    taille: 5_136_175_328,
};

/// Tokenizer officiel de Mistral 7B Instruct v0.3 (vocabulaire de 32 768 tokens).
pub const TOKENIZER: FichierModele = FichierModele {
    nom: "tokenizer.json",
    url: "https://huggingface.co/mistralai/Mistral-7B-Instruct-v0.3/resolve/c170c708c41dac9275d15a8fff4eca08d52bab71/tokenizer.json",
    sha256: "e553af6fff7d7ad76e830608b218c5c0b0822998d5a1a96099a74cd3c1cb1a49",
    taille: 1_961_548,
};

pub const FICHIERS: [&FichierModele; 2] = [&TOKENIZER, &GGUF];

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressionTelechargement {
    pub fichier: &'static str,
    pub recu: u64,
    pub total: u64,
}

/// Un fichier est considéré installé s'il a la taille attendue (son empreinte a été vérifiée au téléchargement).
pub fn est_present(dossier: &Path, f: &FichierModele) -> bool {
    std::fs::metadata(dossier.join(f.nom)).is_ok_and(|m| m.len() == f.taille)
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
    for f in FICHIERS {
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
    if recu > f.taille {
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
    let partiel: PathBuf = dossier.join(format!("{}.part", f.nom));
    let (mut hash, mut recu) = relire_partiel(&partiel, f).await?;

    // `.part` déjà complet (app fermée avant l'installation) : rien à demander au serveur,
    // une requête `Range` au-delà de la fin obtiendrait un 416.
    if recu < f.taille {
        recevoir(client, &partiel, f, annulation, progression, &mut hash, &mut recu).await?;
    }

    let empreinte = hex::encode(hash.finalize());
    if recu != f.taille || empreinte != f.sha256 {
        let _ = tokio::fs::remove_file(&partiel).await;
        return Err(format!("Fichier {} corrompu (empreinte SHA-256 inattendue) : relancez le téléchargement.", f.nom));
    }
    tokio::fs::rename(&partiel, dossier.join(f.nom))
        .await
        .map_err(|e| format!("Installation impossible ({}) : {e}", f.nom))?;
    progression(ProgressionTelechargement { fichier: f.nom, recu, total: f.taille });
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
    if *recu > 0 {
        let reprise_acceptee =
            reponse.status() == StatusCode::PARTIAL_CONTENT && debut_plage(&reponse) == Some(*recu);
        if !reprise_acceptee {
            // Reprise ignorée (200 : le corps est le fichier entier), refusée (416) ou incohérente
            // (plage décalée) : on repart de zéro.
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

    let pas = (f.taille / 200).max(1 << 20);
    let mut dernier_signal = *recu;
    progression(ProgressionTelechargement { fichier: f.nom, recu: *recu, total: f.taille });

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
            progression(ProgressionTelechargement { fichier: f.nom, recu: *recu, total: f.taille });
        }
    }
    sortie.flush().await.map_err(erreur_es)
}
