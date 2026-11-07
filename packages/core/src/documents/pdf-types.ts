/**
 * Sous-ensemble minimal des types pdfmake, pour que @wealth-management/core
 * reste sans dépendance. Le rendu effectif est fait par l'application.
 */
export type PdfContent = string | PdfNode | PdfContent[];

export interface PdfNode {
  text?: PdfContent;
  stack?: PdfContent[];
  columns?: PdfContent[];
  ul?: PdfContent[];
  ol?: PdfContent[];
  table?: { widths?: (string | number)[]; headerRows?: number; body: PdfContent[][] };
  layout?: string;
  style?: string | string[];
  bold?: boolean;
  italics?: boolean;
  fontSize?: number;
  color?: string;
  alignment?: 'left' | 'right' | 'center' | 'justify';
  margin?: number | [number, number] | [number, number, number, number];
  width?: string | number;
  pageBreak?: 'before' | 'after';
  unbreakable?: boolean;
  fillColor?: string;
  colSpan?: number;
  [key: string]: unknown;
}

export interface PdfDocument {
  info?: { title?: string; author?: string; subject?: string };
  pageSize?: string;
  pageMargins?: [number, number, number, number];
  content: PdfContent[];
  styles?: Record<string, Omit<PdfNode, 'text'>>;
  defaultStyle?: Omit<PdfNode, 'text'>;
  footer?: (currentPage: number, pageCount: number) => PdfContent;
}

export const STYLES_DOCUMENT: PdfDocument['styles'] = {
  titre: { fontSize: 17, bold: true, alignment: 'center', margin: [0, 0, 0, 4] },
  sousTitre: { fontSize: 10, italics: true, alignment: 'center', color: '#555555', margin: [0, 0, 0, 16] },
  h1: { fontSize: 12, bold: true, margin: [0, 14, 0, 6], color: '#1f3a5f' },
  h2: { fontSize: 10.5, bold: true, margin: [0, 8, 0, 4] },
  petit: { fontSize: 8, color: '#666666' },
  label: { bold: true },
};
