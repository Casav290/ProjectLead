# Brancher projectlead.io (à faire par Claude Desktop, sur l'ordinateur d'Ève)

Même méthode qu'InvoiceLead (`Casav290/invoicelead`, `docs/RESEND.md`). Le conteneur de la session
ProjectLead n'atteint ni Porkbun ni Resend. Aucune clé ne doit être recopiée dans une conversation,
un ticket ou le dépôt.

Repères Neon : projet `gentle-frog-61717092`, branche `br-broad-dream-b4d44vqe` (production),
fonction `projectlead`. Adresse actuelle :
https://br-broad-dream-b4d44vqe-projectlead.compute.c-6.us-east-2.aws.neon.tech

## 1. Domaine vers la fonction Neon

1. Neon (connecteur ou console) : enregistrer le domaine personnalisé `projectlead.io` sur la branche
   ci-dessus, cible `function`, identifiant `projectlead` (outil `register_functions_custom_domain`).
   Faire de même pour `www.projectlead.io`. Noter la `cname_target` rendue.
2. Porkbun, « Domain Management », ligne `projectlead.io`, bouton « DNS » :
   un enregistrement `ALIAS` sans nom (racine) vers la `cname_target`, et un `CNAME` `www` vers la même
   cible. Supprimer seulement les enregistrements de parking de Porkbun qui occupent la racine ou `www`
   (A, ALIAS ou CNAME par défaut), rien d'autre.

## 2. Emails par Resend

1. Resend, « Domains », « Add Domain » : `projectlead.io`.
2. Recopier chez Porkbun chaque enregistrement affiché par Resend (même type, nom sans
   `.projectlead.io`, même valeur), plus un TXT `_dmarc` avec `v=DMARC1; p=none;`.
3. Resend, « Verify DNS Records ».
4. Resend, « API Keys », « Create API Key » : nom `projectlead-production`, « Sending access »,
   domaine `projectlead.io`.

## 3. Donner la clé et l'adresse à la fonction

Redéployer la fonction `projectlead` en ne changeant que son environnement (outil `deploy_function`,
sans `zip`). Garder toutes les variables déjà présentes (`PL_DATABASE_URL`, `APP_SECRET`,
`TASKS_SECRET`) et ajouter ou remplacer :

- `RESEND_API_KEY` : la clé Resend ;
- `PUBLIC_URL` : `https://projectlead.io` ;
- `EMAIL_FROM` : `ProjectLead <suivi@projectlead.io>`.

Si l'environnement actuel ne peut pas être relu, ne pas redéployer : signaler à la session
ProjectLead qu'il faut le faire depuis elle.

## 4. Vérifier

`https://projectlead.io/api/health` répond (le certificat peut prendre quelques minutes). Puis le
dire à la session ProjectLead, qui fait un premier envoi réel et met `docs/PLAN.md` à jour.
