import {
  type ApplicationConfig,
  LOCALE_ID,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';
import { provideRouter, withComponentInputBinding, withHashLocation } from '@angular/router';
import { routes } from './app.routes';
import { BaseDeDonnees } from './infrastructure/base-de-donnees.service';

registerLocaleData(localeFr);

export const appConfig: ApplicationConfig = {
  providers: [
    { provide: LOCALE_ID, useValue: 'fr-FR' },
    provideBrowserGlobalErrorListeners(),
    // Hash : robuste quel que soit le protocole de la webview (tauri://, http://tauri.localhost…).
    provideRouter(routes, withComponentInputBinding(), withHashLocation()),
    provideAppInitializer(() => inject(BaseDeDonnees).initialiser()),
  ],
};
