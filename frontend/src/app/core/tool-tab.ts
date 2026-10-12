/**
 * Ouverture d'un outil du lab (éditeur, pgAdmin) dans un nouvel onglet.
 *
 * Le moteur met jusqu'à ~30 s à rendre l'URL à ticket : un `window.open` fait
 * à ce moment-là serait bloqué par le navigateur. L'onglet est donc ouvert
 * TOUT DE SUITE, dans le geste du clic, puis dirigé vers l'URL quand elle
 * arrive. L'URL porte un ticket à usage unique : elle n'est ni gardée ni
 * affichée, et l'appelant la valide (origine du lab, https, préfixe) AVANT
 * d'appeler `sendTab`.
 */
export function preopenTab(label: string): Window | null {
  const tab = window.open('', '_blank');
  if (tab) {
    try {
      tab.document.title = label;
      tab.document.body.textContent = label;
    } catch { /* onglet déjà navigué */ }
  }
  return tab;
}

/** Dirige l'onglet pré-ouvert vers `url`. Faux si le navigateur l'a bloqué ou fermé. */
export function sendTab(tab: Window | null, url: string): boolean {
  if (!tab || tab.closed) return false;
  tab.opener = null;
  tab.location.replace(url);
  return true;
}

/** Rupture Foyer : en dessous, la navigation recouvre l'écran (téléphone). */
const SMALL_SCREEN = '(max-width: 899px)';

export type Delivery = 'tab' | 'here' | 'blocked';

/** Une ouverture en cours : `deliver` quand l'URL arrive, `cancel` si elle n'arrive pas. */
export interface ToolOpening {
  deliver(url: string): Delivery;
  cancel(): void;
}

/**
 * Ouverture d'un outil, à appeler DANS le geste du clic, avant l'appel au moteur.
 *
 * `sameTabOnPhone` faux (éditeur, pgAdmin) : l'onglet pré-ouvert, rien d'autre.
 *
 * `sameTabOnPhone` vrai (conversations, pensées pour le téléphone) :
 *  - petit écran : aucun onglet n'est ouvert, la page courante ira à l'URL.
 *    Une navigation du même onglet n'est jamais bloquée, alors qu'un onglet
 *    pré-ouvert passe devant et relègue celui-ci à l'arrière-plan, où un
 *    navigateur de téléphone peut suspendre la requête en attente — le ticket
 *    (60 s) expirerait avant d'être suivi. « Précédent » ramène ici ;
 *  - grand écran : onglet pré-ouvert, comme l'éditeur ; si le navigateur l'a
 *    refusé (vue intégrée, application installée), repli sur le même onglet.
 *    Un onglet que l'utilisateur a lui-même refermé n'est pas remplacé.
 */
export function beginOpening(label: string, sameTabOnPhone = false): ToolOpening {
  const here = sameTabOnPhone && window.matchMedia(SMALL_SCREEN).matches;
  const tab = here ? null : preopenTab(label);
  const fallback = sameTabOnPhone && !tab;
  return {
    deliver(url: string): Delivery {
      if (here || fallback) { window.location.assign(url); return 'here'; }
      return sendTab(tab, url) ? 'tab' : 'blocked';
    },
    cancel(): void { tab?.close(); },
  };
}
