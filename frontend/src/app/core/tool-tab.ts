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
