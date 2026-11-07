# Wealth Management — gestion de patrimoine (immobilier locatif, sociétés)

Application **desktop (Windows / macOS / Linux) et mobile (Android / iOS)** construite avec
**Tauri 2**, **Angular 22** et **SQLite**, organisée en monorepo **pnpm**.

## Fonctionnalités

- **Sociétés** (SCI, SARL de famille, SAS…) : raison sociale, forme, SIREN, RCS, date de création, capital,
  nombre de parts, valeur nominale, régime fiscal, représentant, siège, IBAN.
  Associés avec répartition des parts (et contrôle de cohérence avec le nombre de parts total).
- **Biens** (appartement, maison, studio, parking, local…) détenus **en nom propre ou via une société** :
  adresse, bâtiment / escalier / étage / porte, n° de lot, tantièmes, lots annexes, surfaces, pièces,
  chauffage, DPE / GES, acquisition, taxe foncière, charges de copro, rattachement à un immeuble parent.
- **Locataires** : état civil complet, contact, situation professionnelle, revenus, pièce d’identité.
  **Historique** des baux par locataire et par bien.
- **Baux** : vide, meublé, mobilité, étudiant, parking, professionnel, commercial ; colocation
  (titulaire / colocataires), garants (caution, Visale), statut brouillon → en cours → terminé,
  zone tendue, IRL de référence. Contrôle « un seul bail actif par bien » et du dépôt de garantie légal.
- **Génération PDF** : contrat de location, quittance de loyer (ou reçu de paiement partiel),
  avis d’échéance. Montants en toutes lettres.
- **Suivi des paiements** : échéances mensuelles générées automatiquement (prorata d’entrée et de sortie,
  terme à échoir / échu), paiements multiples ou partiels, encaissement en un clic, impayés,
  **révision IRL** avec historique, tableau de bord (encaissé / attendu sur 12 mois, alertes de révision
  et de fin de bail).
- Sauvegarde complète au format JSON.

> ⚠️ Les modèles de documents sont fournis **à titre indicatif** : vérifiez-les au regard du contrat type
> réglementaire (décret n° 2015-587) et de votre situation avant signature.

## Architecture

```
wealth-management/
├── packages/
│   ├── core/   @wealth-management/core — types métier, libellés, dates, calculs (échéances, IRL, prorata),
│   │                                     montants en lettres, générateurs de documents (contrat, quittance, avis)
│   └── db/     @wealth-management/db   — schéma SQLite + migrations, repositories indépendants du driver
└── apps/
    └── wealth-management/  @wealth-management/app — Angular 22 (standalone, signals, zoneless) + Tauri 2
        ├── src/app/patrimoine/      contexte Patrimoine : sociétés (associés), biens
        ├── src/app/location/        contexte Location : locataires, baux (garants, fin de bail)
        ├── src/app/loyers/          contexte Loyers : échéances, paiements, révisions IRL
        ├── src/app/pilotage/        tableau de bord
        ├── src/app/parametres/      paramètres, sauvegarde
        ├── src/app/infrastructure/  adaptateurs techniques : SQLite (Tauri), export PDF, brouillons
        ├── src/app/ui/              briques de présentation sans métier : icône, fiche, kit de formulaire…
        └── src-tauri/               crate Rust (plugins sql/sqlite, dialog, fs), config, capabilities
```

- Toute la logique métier est en TypeScript, **testée sans Tauri** : `@wealth-management/db` est testé sur un vrai
  SQLite via `node:sqlite`, avec le même contrat (`SqlDriver`) que `@tauri-apps/plugin-sql`.
- Le schéma est migré au démarrage de l’application (table `_migrations`). Pour faire évoluer la base,
  ajoutez une entrée à `MIGRATIONS` dans `packages/db/src/migrations.ts` (ne modifiez jamais une migration
  déjà livrée).
- La base `wealth-management.db` est créée dans le dossier de données de l’application
  (ex. `~/.config/fr.wealthmanagement.app/` sous Linux, `%APPDATA%\fr.wealthmanagement.app\` sous Windows).

## Prérequis

- Node.js ≥ 22.13 et pnpm ≥ 10
- Rust (stable) — https://rustup.rs
- Dépendances système Tauri : https://v2.tauri.app/start/prerequisites/
  - Linux / WSL :
    ```bash
    sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev \
      libssl-dev libayatana-appindicator3-dev librsvg2-dev pkg-config
    ```
- Android : Android Studio, SDK + NDK, variables `ANDROID_HOME` et `NDK_HOME`, puis
  `rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android`
- iOS (macOS uniquement) : Xcode, puis `rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios`

## Commandes

```bash
pnpm install            # installe tout le monorepo
pnpm dev                # lance l’application desktop (Angular + Tauri, rechargement à chaud)
pnpm build              # construit les installateurs desktop

pnpm android:init       # une seule fois : génère le projet Android (src-tauri/gen/android)
pnpm android:dev        # lance sur émulateur / appareil
pnpm android:build      # APK / AAB

pnpm ios:init           # une seule fois (macOS)
pnpm ios:dev
pnpm ios:build

pnpm test               # tests unitaires et d’intégration (core + db)
pnpm typecheck          # vérification TypeScript de tous les paquets
pnpm web:build          # build Angular seul
```

L’interface ne fonctionne que dans Tauri (SQLite n’est pas accessible depuis un simple navigateur).

## Pistes d’évolution

- Régularisation annuelle des charges, état des lieux, inventaire meublé
- Stockage des pièces jointes (pièces d’identité, diagnostics, bail signé)
- Envoi des quittances par e-mail, relances d’impayés
- Synchronisation multi-appareils (le driver SQL est abstrait : un backend distant peut être branché)
- Chiffrement de la base (SQLCipher) — les données locataires sont des données personnelles (RGPD)
