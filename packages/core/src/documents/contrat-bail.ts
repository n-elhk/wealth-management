import { formatDateFr, formatDateLongue } from '../dates.js';
import { formatAdresse, identiteBailleur, localisationBien, nomComplet } from '../identite.js';
import {
  LIBELLES_MODE_CHARGES,
  LIBELLES_MODE_CHAUFFAGE,
  LIBELLES_MODE_PAIEMENT,
  LIBELLES_REGIME_JURIDIQUE,
  LIBELLES_TYPE_BIEN,
} from '../libelles.js';
import { dateFinContractuelle } from '../loyers.js';
import { arrondi, formatEuro, montantEnLettres } from '../montants.js';
import type { Bail, Bien, Garant, Locataire, ProfilBailleur, Societe, TypeBail } from '../schemas.js';
import { STYLES_DOCUMENT, type PdfContent, type PdfDocument } from './pdf-types.js';

export interface ContexteContrat {
  bail: Bail;
  bien: Bien;
  locataires: Locataire[];
  garants: Garant[];
  /** Société propriétaire si le bien est détenu via une société. */
  societe: Societe | null;
  /** Profil du bailleur en nom propre. */
  profil: ProfilBailleur | null;
  lieuSignature?: string;
  dateSignature?: string;
}

const TITRES: Record<TypeBail, { titre: string; sousTitre: string }> = {
  habitation_vide: {
    titre: 'CONTRAT DE LOCATION',
    sousTitre:
      "Locaux vides à usage d'habitation — soumis au titre Ier de la loi n° 89-462 du 6 juillet 1989",
  },
  habitation_meuble: {
    titre: 'CONTRAT DE LOCATION MEUBLÉE',
    sousTitre:
      "Logement meublé à usage de résidence principale — soumis au titre Ier bis de la loi n° 89-462 du 6 juillet 1989",
  },
  mobilite: {
    titre: 'BAIL MOBILITÉ',
    sousTitre: 'Logement meublé — articles 25-12 et suivants de la loi n° 89-462 du 6 juillet 1989',
  },
  etudiant: {
    titre: 'BAIL ÉTUDIANT',
    sousTitre: 'Logement meublé loué à un étudiant — article 25-7 de la loi n° 89-462 du 6 juillet 1989',
  },
  parking: {
    titre: "CONTRAT DE LOCATION D'EMPLACEMENT",
    sousTitre: 'Parking / garage — régi par les articles 1709 et suivants du Code civil',
  },
  professionnel: {
    titre: 'BAIL PROFESSIONNEL',
    sousTitre: "Régi par l'article 57 A de la loi n° 86-1290 du 23 décembre 1986",
  },
  commercial: {
    titre: 'BAIL COMMERCIAL',
    sousTitre: 'Régi par les articles L. 145-1 et suivants du Code de commerce',
  },
};

const estHabitation = (t: TypeBail) =>
  t === 'habitation_vide' || t === 'habitation_meuble' || t === 'mobilite' || t === 'etudiant';
const estMeuble = (t: TypeBail) => t === 'habitation_meuble' || t === 'mobilite' || t === 'etudiant';

function ligne(label: string, valeur: string | number | null | undefined): PdfContent | null {
  if (valeur === null || valeur === undefined || valeur === '') return null;
  return { text: [{ text: `${label} : `, bold: true }, String(valeur)], margin: [0, 1, 0, 1] };
}

function compact(items: (PdfContent | null | false | undefined)[]): PdfContent[] {
  return items.filter((x): x is PdfContent => !!x);
}

function paragraphe(text: string): PdfContent {
  return { text, alignment: 'justify', margin: [0, 2, 0, 4] };
}

export function genererContratBail(ctx: ContexteContrat): PdfDocument {
  const { bail, bien, locataires, garants } = ctx;
  const bailleur = identiteBailleur(ctx.profil, ctx.societe);
  const titres = TITRES[bail.type_bail];
  const habitation = estHabitation(bail.type_bail);
  const meuble = estMeuble(bail.type_bail);
  const total = arrondi(bail.loyer_hc + bail.charges);
  const plusieursLocataires = locataires.length > 1;

  const content: PdfContent[] = [
    { text: titres.titre, style: 'titre' },
    { text: titres.sousTitre, style: 'sousTitre' },
    bail.reference ? { text: `Référence : ${bail.reference}`, alignment: 'right', style: 'petit' } : '',

    // I. Parties
    { text: 'I. DÉSIGNATION DES PARTIES', style: 'h1' },
    { text: 'Le présent contrat est conclu entre les soussignés :', margin: [0, 0, 0, 6] },
    { text: 'LE BAILLEUR', style: 'h2' },
    {
      stack: compact([
        { text: bailleur.designation, bold: true },
        ...bailleur.details,
        bailleur.adresse ? `Demeurant / siège : ${bailleur.adresse}` : null,
        ctx.societe?.email ?? ctx.profil?.email ?? null,
      ]),
      margin: [10, 0, 0, 6],
    },
    { text: plusieursLocataires ? 'LES LOCATAIRES' : 'LE LOCATAIRE', style: 'h2' },
    ...locataires.map((l) => ({
      stack: compact([
        { text: nomComplet(l, true), bold: true },
        l.date_naissance
          ? `Né(e) le ${formatDateFr(l.date_naissance)}${l.lieu_naissance ? ` à ${l.lieu_naissance}` : ''}`
          : null,
        l.profession ? `Profession : ${l.profession}` : null,
        l.email || l.telephone ? [l.email, l.telephone].filter(Boolean).join(' — ') : null,
      ]),
      margin: [10, 0, 0, 6] as [number, number, number, number],
    })),
    locataires.length === 0 ? { text: '[Locataire à désigner]', italics: true, margin: [10, 0, 0, 6] } : '',

    // II. Objet
    { text: 'II. OBJET DU CONTRAT', style: 'h1' },
    paragraphe(
      `Le présent contrat a pour objet la location ${meuble ? "d'un logement meublé" : habitation ? "d'un logement" : "d'un local"} ainsi déterminé :`,
    ),
    { text: 'A. Consistance', style: 'h2' },
    ...compact([
      ligne('Adresse', formatAdresse(bien)),
      ligne('Localisation', localisationBien(bien)),
      ligne('Type de bien', LIBELLES_TYPE_BIEN[bien.type_bien]),
      bien.regime_juridique ? ligne("Régime juridique de l'immeuble", LIBELLES_REGIME_JURIDIQUE[bien.regime_juridique]) : null,
      ligne('Période de construction', bien.annee_construction),
      ligne('Surface habitable', bien.surface_habitable ? `${bien.surface_habitable} m²` : null),
      ligne('Surface du terrain', bien.surface_terrain ? `${bien.surface_terrain} m²` : null),
      ligne('Nombre de pièces principales', bien.nb_pieces),
      ligne('Nombre de chambres', bien.nb_chambres),
      ligne('Équipements', bien.equipements),
      bien.chauffage_mode
        ? ligne(
            'Chauffage',
            `${LIBELLES_MODE_CHAUFFAGE[bien.chauffage_mode]}${bien.chauffage_energie ? ` (${bien.chauffage_energie})` : ''}`,
          )
        : null,
      bien.eau_chaude_mode ? ligne("Production d'eau chaude", LIBELLES_MODE_CHAUFFAGE[bien.eau_chaude_mode]) : null,
      bien.dpe_classe
        ? ligne(
            'Performance énergétique (DPE)',
            `classe ${bien.dpe_classe}${bien.dpe_consommation ? ` — ${bien.dpe_consommation} kWh/m²/an` : ''}${bien.ges_classe ? ` — GES ${bien.ges_classe}` : ''}`,
          )
        : null,
    ]),
    { text: 'B. Destination des locaux', style: 'h2' },
    paragraphe(
      bail.destination ||
        (habitation ? "Usage exclusif d'habitation, à titre de résidence principale du locataire." : 'Usage conforme à la nature du local.'),
    ),
    ...(bien.lots_annexes
      ? [{ text: 'C. Locaux et équipements accessoires à usage privatif', style: 'h2' }, paragraphe(bien.lots_annexes)]
      : []),
    ...(bien.parties_communes
      ? [{ text: "D. Parties et équipements à usage commun", style: 'h2' }, paragraphe(bien.parties_communes)]
      : []),

    // III. Durée
    { text: 'III. DATE DE PRISE D’EFFET ET DURÉE', style: 'h1' },
    ...compact([
      ligne("Date de prise d'effet", formatDateLongue(bail.date_debut)),
      ligne('Durée du contrat', `${bail.duree_mois} mois`),
      ligne('Échéance contractuelle', formatDateLongue(dateFinContractuelle(bail))),
    ]),
    paragraphe(
      bail.type_bail === 'mobilite'
        ? "Le bail mobilité n'est ni renouvelable ni reconductible. À son terme, la poursuite de l'occupation nécessite un nouveau contrat de location."
        : bail.type_bail === 'etudiant'
          ? "Le bail étudiant prend fin à son terme sans reconduction tacite."
          : bail.tacite_reconduction
            ? "À défaut de congé délivré dans les conditions de forme et de délai prévues par la loi, le contrat est reconduit tacitement pour une durée identique."
            : 'Le contrat prend fin à son terme.',
    ),

    // IV. Conditions financières
    { text: 'IV. CONDITIONS FINANCIÈRES', style: 'h1' },
    { text: 'A. Loyer', style: 'h2' },
    paragraphe(
      `Le loyer mensuel, hors charges, est fixé à ${formatEuro(bail.loyer_hc)} (${montantEnLettres(bail.loyer_hc)}).`,
    ),
    ...(bail.zone_tendue
      ? compact([
          paragraphe(
            "Le logement est situé dans une zone d'encadrement de l'évolution des loyers (décret n° 2017-1198).",
          ),
          ligne('Loyer de référence majoré', bail.loyer_reference_majore ? `${formatEuro(bail.loyer_reference_majore)} / m²` : null),
          ligne('Complément de loyer', bail.complement_loyer ? formatEuro(bail.complement_loyer) : null),
          ligne('Dernier loyer appliqué au précédent locataire', bail.dernier_loyer_precedent ? formatEuro(bail.dernier_loyer_precedent) : null),
        ])
      : []),
    ...(habitation
      ? [
          paragraphe(
            `Le loyer sera révisé chaque année à la date anniversaire du contrat, en fonction de la variation de l'Indice de Référence des Loyers (IRL) publié par l'INSEE.${
              bail.irl_trimestre_reference
                ? ` Trimestre de référence : ${bail.irl_trimestre_reference}${bail.irl_valeur_reference ? ` (valeur ${bail.irl_valeur_reference})` : ''}.`
                : ''
            }`,
          ),
        ]
      : []),
    { text: 'B. Charges récupérables', style: 'h2' },
    paragraphe(
      bail.charges > 0
        ? `Les charges sont fixées à ${formatEuro(bail.charges)} par mois, sous forme de ${LIBELLES_MODE_CHARGES[bail.mode_charges].toLowerCase()}.${
            bail.mode_charges === 'provision'
              ? ' Elles feront l’objet d’une régularisation annuelle sur justificatifs.'
              : ''
          }`
        : 'Aucune provision pour charges n’est demandée.',
    ),
    { text: 'C. Modalités de paiement', style: 'h2' },
    {
      table: {
        widths: ['*', 'auto'],
        body: [
          ['Loyer hors charges', { text: formatEuro(bail.loyer_hc), alignment: 'right' }],
          ['Charges', { text: formatEuro(bail.charges), alignment: 'right' }],
          [{ text: 'Total mensuel', bold: true }, { text: formatEuro(total), bold: true, alignment: 'right' }],
        ],
      },
      layout: 'lightHorizontalLines',
      margin: [0, 2, 0, 6],
    },
    paragraphe(
      `Le loyer et les charges sont payables mensuellement ${
        bail.paiement_terme === 'echu' ? 'à terme échu' : `d'avance, le ${bail.jour_paiement} de chaque mois`
      }${bail.mode_paiement ? `, par ${LIBELLES_MODE_PAIEMENT[bail.mode_paiement].toLowerCase()}` : ''}.${
        (ctx.societe?.iban ?? ctx.profil?.iban) ? ` IBAN du bailleur : ${ctx.societe?.iban ?? ctx.profil?.iban}.` : ''
      }`,
    ),

    // V. Garanties
    { text: 'V. GARANTIES', style: 'h1' },
    paragraphe(
      bail.depot_garantie > 0
        ? `Le locataire verse ce jour un dépôt de garantie de ${formatEuro(bail.depot_garantie)} (${montantEnLettres(bail.depot_garantie)}), non productif d’intérêts. Il sera restitué dans un délai d’un mois à compter de la remise des clés si l’état des lieux de sortie est conforme à l’état des lieux d’entrée, de deux mois dans le cas contraire, déduction faite des sommes restant dues au bailleur.`
        : 'Aucun dépôt de garantie n’est exigé.',
    ),
    ...(garants.length
      ? [
          { text: 'Cautionnement', style: 'h2' },
          ...garants.map((g) =>
            paragraphe(
              g.type_garant === 'visale'
                ? `Garantie Visale — ${g.nom}${g.notes ? ` (${g.notes})` : ''}.`
                : `${nomComplet(g, true)}${g.adresse ? `, demeurant ${g.adresse}` : ''}, se porte caution ${
                    plusieursLocataires ? 'solidaire ' : ''
                  }des obligations du locataire${g.montant_engagement ? ` dans la limite de ${formatEuro(g.montant_engagement)}` : ''}${
                    g.duree_engagement ? `, pour une durée de ${g.duree_engagement}` : ''
                  }, selon acte de cautionnement annexé.`,
            ),
          ),
        ]
      : []),

    // VI. Solidarité
    ...(plusieursLocataires
      ? [
          { text: 'VI. CLAUSE DE SOLIDARITÉ', style: 'h1' },
          paragraphe(
            "Les locataires sont tenus solidairement et indivisiblement de l'exécution des obligations du présent contrat. En cas de départ d'un colocataire ayant donné congé, la solidarité cesse au plus tard six mois après la date d'effet du congé si un nouveau colocataire figure au bail.",
          ),
        ]
      : []),

    // VII. Clause résolutoire
    { text: `${plusieursLocataires ? 'VII' : 'VI'}. CLAUSE RÉSOLUTOIRE`, style: 'h1' },
    paragraphe(
      "Le présent contrat sera résilié de plein droit, deux mois après un commandement de payer demeuré infructueux, à défaut de paiement du loyer ou des charges aux termes convenus, ou de versement du dépôt de garantie ; un mois après un commandement demeuré infructueux à défaut d'assurance contre les risques locatifs ; ainsi qu'en cas de troubles de voisinage constatés par une décision de justice passée en force de chose jugée.",
    ),

    // VIII. Clauses particulières
    ...(bail.clauses_particulieres
      ? [{ text: `${plusieursLocataires ? 'VIII' : 'VII'}. CLAUSES PARTICULIÈRES`, style: 'h1' }, paragraphe(bail.clauses_particulieres)]
      : []),

    // Annexes
    { text: 'ANNEXES', style: 'h1' },
    {
      ul: compact([
        habitation && "Notice d'information relative aux droits et obligations des locataires et des bailleurs",
        'Dossier de diagnostic technique (DPE, ERP, CREP, électricité, gaz, amiante le cas échéant)',
        'État des lieux d’entrée',
        meuble && 'Inventaire et état détaillé du mobilier',
        bien.regime_juridique === 'copropriete' && 'Extraits du règlement de copropriété',
        garants.some((g) => g.type_garant === 'personne') && 'Acte(s) de cautionnement',
        garants.some((g) => g.type_garant === 'visale') && 'Visa Visale',
      ]),
      margin: [0, 0, 0, 10],
    },

    // Signatures
    {
      text: `Fait à ${ctx.lieuSignature || bien.ville || '……………………'}, le ${
        ctx.dateSignature ? formatDateLongue(ctx.dateSignature) : bail.date_signature ? formatDateLongue(bail.date_signature) : '……………………'
      }, en ${locataires.length + 1 + (garants.filter((g) => g.type_garant === 'personne').length)} exemplaires originaux.`,
      margin: [0, 12, 0, 16],
    },
    {
      unbreakable: true,
      columns: [
        {
          width: '*',
          stack: [
            { text: 'Le bailleur', bold: true },
            { text: bailleur.signataire, fontSize: 9 },
            { text: '« Lu et approuvé »', italics: true, fontSize: 8, color: '#666666', margin: [0, 50, 0, 0] },
          ],
        },
        {
          width: '*',
          stack: [
            { text: plusieursLocataires ? 'Les locataires' : 'Le locataire', bold: true },
            ...locataires.map((l) => ({ text: nomComplet(l, true), fontSize: 9 })),
            { text: '« Lu et approuvé »', italics: true, fontSize: 8, color: '#666666', margin: [0, 50, 0, 0] },
          ],
        },
      ],
    },
  ];

  return {
    info: { title: `${titres.titre} — ${bien.libelle}`, author: bailleur.designation, subject: 'Contrat de location' },
    pageSize: 'A4',
    pageMargins: [50, 50, 50, 60],
    defaultStyle: { fontSize: 10 },
    styles: STYLES_DOCUMENT,
    content,
    footer: (page, count) => ({
      columns: [
        { text: 'Paraphes : ……… / ………', style: 'petit', margin: [50, 0, 0, 0] },
        { text: `Page ${page} / ${count}`, style: 'petit', alignment: 'right', margin: [0, 0, 50, 0] },
      ],
    }),
  };
}
