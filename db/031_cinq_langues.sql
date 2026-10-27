-- Cinq langues partout (27.10.2026) : fr, de, en, it, es.
--
-- `projects.doc_locale` : la langue des documents du client de ce projet (suivi envoyé au client, page de suivi,
-- brouillons de facture). Vide = la langue de l'entreprise (`accounts.locale`).
-- `bookings.locale` : la langue de la personne qui a pris le rendez-vous (confirmation, page de gestion).
-- `users.locale` et `accounts.locale` : une des cinq langues ; une valeur d'avant hors liste (« pt » d'un Compte Lead,
-- par exemple) redevient « fr » avant que la contrainte soit posée. Rejouable.

alter table projects add column if not exists doc_locale text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'projects_doc_locale_check') then
    alter table projects add constraint projects_doc_locale_check check (doc_locale in ('fr', 'de', 'en', 'it', 'es'));
  end if;
end $$;

alter table bookings add column if not exists locale text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'bookings_locale_check') then
    alter table bookings add constraint bookings_locale_check check (locale in ('fr', 'de', 'en', 'it', 'es'));
  end if;
end $$;

update users set locale = 'fr' where locale is null or locale not in ('fr', 'de', 'en', 'it', 'es');
update accounts set locale = 'fr' where locale is null or locale not in ('fr', 'de', 'en', 'it', 'es');
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'users_locale_check') then
    alter table users add constraint users_locale_check check (locale in ('fr', 'de', 'en', 'it', 'es'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'accounts_locale_check') then
    alter table accounts add constraint accounts_locale_check check (locale in ('fr', 'de', 'en', 'it', 'es'));
  end if;
end $$;
