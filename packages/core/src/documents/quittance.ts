import { formatDateFr, formatDateLongue, libellePeriode } from '../dates.js';
import { formatAdresse, identiteBailleur, localisationBien, nomComplet } from '../identite.js';
import { totalEcheance } from '../loyers.js';
import { arrondi, formatEuro, montantEnLettres, somme } from '../montants.js';
import type { Bail, Bien, Echeance, Locataire, Paiement, ProfilBailleur, Societe } from '../schemas.js';
import { STYLES_DOCUMENT, type PdfContent, type PdfDocument } from './pdf-types.js';

export interface ContexteQuittance {
  bail: Bail;
  bien: Bien;
  locataires: Locataire[];
  echeance: Echeance;
  paiements: Paiement[];
  societe: Societe | null;
  profil: ProfilBailleur | null;
  dateEmission: string;
}

function entete(ctx: ContexteQuittance, titre: string): PdfContent[] {
  const bailleur = identiteBailleur(ctx.profil, ctx.societe);
  return [
    {
      columns: [
        {
          width: '*',
          stack: [
            { text: bailleur.designation, bold: true },
            ...bailleur.details.map((d) => ({ text: d, fontSize: 9 })),
            { text: bailleur.adresse, fontSize: 9 },
          ],
        },
        {
          width: '*',
          margin: [40, 30, 0, 0],
          stack: [
            ...ctx.locataires.map((l) => ({ text: nomComplet(l, true), bold: true })),
            { text: formatAdresse(ctx.bien, '\n'), fontSize: 9 },
          ],
        },
      ],
    },
    { text: titre, style: 'titre', margin: [0, 30, 0, 2] },
    { text: `Période : ${libellePeriode(ctx.echeance.periode)}`, style: 'sousTitre' },
  ];
}

function tableauMontants(e: Echeance, extra: PdfContent[][] = []): PdfContent {
  return {
    table: {
      widths: ['*', 'auto'],
      body: [
        [
          { text: 'Désignation', bold: true, fillColor: '#eef2f7' },
          { text: 'Montant', bold: true, alignment: 'right', fillColor: '#eef2f7' },
        ],
        [
          `Loyer du ${formatDateFr(e.date_debut_periode)} au ${formatDateFr(e.date_fin_periode)}`,
          { text: formatEuro(e.loyer), alignment: 'right' },
        ],
        ['Provision / forfait de charges', { text: formatEuro(e.charges), alignment: 'right' }],
        [{ text: 'Total', bold: true }, { text: formatEuro(totalEcheance(e)), bold: true, alignment: 'right' }],
        ...extra,
      ],
    },
    layout: 'lightHorizontalLines',
    margin: [0, 6, 0, 12],
  };
}

function document(ctx: ContexteQuittance, titre: string, content: PdfContent[]): PdfDocument {
  const bailleur = identiteBailleur(ctx.profil, ctx.societe);
  return {
    info: { title: `${titre} — ${libellePeriode(ctx.echeance.periode)}`, author: bailleur.designation },
    pageSize: 'A4',
    pageMargins: [50, 50, 50, 50],
    defaultStyle: { fontSize: 10 },
    styles: STYLES_DOCUMENT,
    content: [
      ...entete(ctx, titre),
      ...content,
      {
        margin: [0, 24, 0, 0],
        columns: [
          { width: '*', text: '' },
          {
            width: 'auto',
            stack: [
              `Fait à ${ctx.societe?.ville || ctx.profil?.ville || ctx.bien.ville || ''}, le ${formatDateLongue(ctx.dateEmission)}`,
              { text: bailleur.signataire, bold: true, margin: [0, 8, 0, 0] },
            ],
          },
        ],
      },
    ],
  };
}

/**
 * Quittance de loyer si l'échéance est intégralement réglée,
 * sinon reçu de paiement partiel (art. 21 de la loi du 6 juillet 1989).
 */
export function genererQuittance(ctx: ContexteQuittance): PdfDocument {
  const e = ctx.echeance;
  const du = totalEcheance(e);
  const paye = somme(ctx.paiements.map((p) => p.montant));
  const complete = paye >= du;
  const bailleur = identiteBailleur(ctx.profil, ctx.societe);
  const locataires = ctx.locataires.map((l) => nomComplet(l, true)).join(', ') || 'le locataire';
  const dernierPaiement = ctx.paiements.map((p) => p.date_paiement).sort().at(-1);
  const titre = complete ? 'QUITTANCE DE LOYER' : 'REÇU DE PAIEMENT PARTIEL';

  return document(ctx, titre, [
    {
      text: [
        `${bailleur.type === 'societe' ? 'La société' : 'Je soussigné(e),'} `,
        { text: bailleur.designation, bold: true },
        `, bailleur du logement situé ${formatAdresse(ctx.bien)}${localisationBien(ctx.bien) ? ` (${localisationBien(ctx.bien)})` : ''}, déclare avoir reçu de `,
        { text: locataires, bold: true },
        ` la somme de `,
        { text: `${formatEuro(paye)} (${montantEnLettres(paye)})`, bold: true },
        complete
          ? ` au titre du paiement du loyer et des charges pour la période de ${libellePeriode(e.periode)}, et ${
              ctx.locataires.length > 1 ? 'leur' : 'lui'
            } en donne quittance, sous réserve de tous ${bailleur.type === 'societe' ? 'ses' : 'mes'} droits.`
          : ` à valoir sur le loyer et les charges de la période de ${libellePeriode(e.periode)}.`,
      ],
      alignment: 'justify',
      margin: [0, 0, 0, 10],
    },
    tableauMontants(
      e,
      complete
        ? []
        : [
            ['Montant reçu', { text: formatEuro(paye), alignment: 'right' }],
            [{ text: 'Reste dû', bold: true }, { text: formatEuro(arrondi(du - paye)), bold: true, alignment: 'right' }],
          ],
    ),
    dernierPaiement ? { text: `Date du paiement : ${formatDateFr(dernierPaiement)}`, margin: [0, 0, 0, 6] } : '',
    {
      text: complete
        ? 'Cette quittance annule tous les reçus qui auraient pu être établis précédemment en cas de paiement partiel du montant ci-dessus. Elle est délivrée sous réserve d’encaissement.'
        : 'Le présent reçu ne vaut pas quittance. Une quittance sera délivrée après paiement intégral de l’échéance.',
      style: 'petit',
    },
  ]);
}

/** Avis d'échéance (appel de loyer) envoyé avant la date de paiement. */
export function genererAvisEcheance(ctx: ContexteQuittance): PdfDocument {
  const e = ctx.echeance;
  const iban = ctx.societe?.iban ?? ctx.profil?.iban;
  return document(ctx, "AVIS D'ÉCHÉANCE", [
    {
      text: `Nous vous prions de bien vouloir régler la somme de ${formatEuro(totalEcheance(e))} au plus tard le ${formatDateLongue(e.date_echeance)}, correspondant au loyer et aux charges de la période de ${libellePeriode(e.periode)}.`,
      alignment: 'justify',
    },
    tableauMontants(e),
    iban ? { text: [{ text: 'IBAN : ', bold: true }, iban] } : '',
    {
      text: 'Cet avis ne vaut pas quittance.',
      style: 'petit',
      margin: [0, 8, 0, 0],
    },
  ]);
}
