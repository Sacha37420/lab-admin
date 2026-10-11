/**
 * Les deux formats d'affichage de toute l'application — un seul de chaque.
 *
 *  - date : jour/mois/année heure:minute, à passer au pipe `date` ;
 *  - SHA git : les 7 premiers caractères.
 */
export const DATE_FORMAT = 'dd/MM/yyyy HH:mm';

export function shortSha(sha: string | null | undefined): string {
  return (sha ?? '').slice(0, 7);
}
