import { Service, inject } from '@angular/core';
import { isTauri } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { BaseDirectory, writeFile } from '@tauri-apps/plugin-fs';
import type { PdfDocument } from '@wealth-management/core';
import { Notifications } from '../ui/notifications.service';

/** Nettoie un nom de fichier (accents conservés, caractères interdits retirés). */
export function nomFichier(...parties: (string | null | undefined)[]): string {
  return parties
    .filter(Boolean)
    .join('_')
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s+/g, '_');
}

@Service()
export class Documents {
  private readonly notifications = inject(Notifications);

  /** Génère un PDF (pdfmake chargé à la demande) puis propose de l'enregistrer. */
  async pdf(doc: PdfDocument, nom: string): Promise<void> {
    try {
      const [{ default: pdfMake }, { default: vfs }] = await Promise.all([
        import('pdfmake/build/pdfmake'),
        import('pdfmake/build/vfs_fonts'),
      ]);
      pdfMake.addVirtualFileSystem(vfs);
      // Les types @wealth-management/core sont un sous-ensemble compatible de pdfmake.
      const buffer = await pdfMake.createPdf(doc as never).getBuffer();
      await this.enregistrer(`${nom}.pdf`, new Uint8Array(buffer), 'PDF', 'pdf');
    } catch (e) {
      this.notifications.erreur(e);
    }
  }

  async json(data: unknown, nom: string): Promise<void> {
    const bytes = new TextEncoder().encode(JSON.stringify(data, null, 2));
    await this.enregistrer(`${nom}.json`, bytes, 'JSON', 'json');
  }

  private async enregistrer(nom: string, data: Uint8Array, libelle: string, extension: string): Promise<void> {
    if (!isTauri()) {
      this.telechargerNavigateur(nom, data);
      return;
    }
    let chemin: string | null = null;
    try {
      chemin = await save({ defaultPath: nom, filters: [{ name: libelle, extensions: [extension] }] });
      if (!chemin) return; // annulé
      await writeFile(chemin, data);
      this.notifications.succes(`Document enregistré : ${chemin}`);
    } catch (e) {
      // Repli (mobile notamment) : écriture dans le dossier Documents de l'application.
      try {
        await writeFile(nom, data, { baseDir: BaseDirectory.Document });
        this.notifications.succes(`Document enregistré dans Documents : ${nom}`);
      } catch {
        this.notifications.erreur(e);
      }
    }
  }

  private telechargerNavigateur(nom: string, data: Uint8Array) {
    const url = URL.createObjectURL(new Blob([data as BlobPart]));
    const a = Object.assign(document.createElement('a'), { href: url, download: nom });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
