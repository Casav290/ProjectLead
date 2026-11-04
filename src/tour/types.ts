/**
 * La visite guidée des applications Lead (04.11.2026). Le moteur (`Tour.tsx`, `TourProvider.tsx`, `art.tsx`,
 * `tour.css`) ne connaît aucune application : chaque application n'apporte que son fichier d'étapes
 * (`steps.<app>.ts`) et ses textes (`tour.*` dans ses fichiers de langue). Pour la reprendre ailleurs : copier
 * `src/tour/`, écrire `steps.<app>.ts`, poser les `data-tour` sur les zones visées, monter `TourProvider` dans la mise
 * en page connectée, ajouter « Revoir la visite » au menu du profil et brancher le drapeau serveur (une colonne
 * `tour_pending` née FAUX puis au défaut VRAI, lue par /api/me, remise à faux par POST /api/me/tour : voir
 * db/034_visite_guidee.sql et server/routes/me.ts ; docs/PASSATION.md, « Visite guidée »).
 */
import type { ArtName } from './art'

export type TourStep = {
  /** Identifiant stable (contrôles du navigateur : `data-tour-step`). */
  id: string
  /**
   * Les zones montrées : un ou plusieurs sélecteurs CSS. Seuls les éléments réellement visibles comptent ; plusieurs
   * éléments → la découpe les entoure tous. Sans cible : la carte se pose au centre (accueil de la visite).
   */
  target?: string | string[]
  /**
   * La zone vit dans le menu latéral, replié sur un écran étroit : la visite l'ouvre le temps de l'étape
   * (`onMenu(true)`), puis le referme.
   */
  inMenu?: boolean
  /** Clés de traduction du titre et du texte (moins de 25 mots, une idée). */
  title: string
  body: string
  /** La petite animation qui montre la fonction (art.tsx). */
  art?: ArtName
  /** Un geste à essayer tout de suite : ferme la visite, puis lance `run` (ex. : ouvrir l'Assistant IA). */
  action?: { label: string; run: () => void }
}

/** Pourquoi la visite s'est fermée : passée, terminée, ou quittée par un clic sur la zone montrée. */
export type TourEnd = 'skip' | 'done' | 'target' | 'action'
