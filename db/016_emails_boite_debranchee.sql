-- Boîte mail privée débranchée (20.10.2026) : ses emails ne deviennent pas visibles des collègues.
--
-- `email_messages.mailbox_id` passe à null quand la boîte disparaît (on delete set null) ; un email sans boîte est
-- celui de l'adresse de capture, visible de toute l'entreprise. Avant cette migration, débrancher sa boîte privée (ou
-- un administrateur qui débranche celle d'un autre, ou l'effacement d'une personne) ouvrait donc ses emails à tous.
-- Désormais, à la disparition d'une boîte NON partagée, quel que soit le chemin (route, cascade, effacement) :
--   - ce qui n'est rattaché à aucun projet (à trier, écarté, projet effacé) part avec la boîte ;
--   - ce qui est rattaché à un projet reste au projet, marqué `orphaned_private` : visible de qui voit le projet
--     (server/routes/mail.ts), et de personne s'il perd un jour son projet (remis « à trier », projet effacé).
-- Les emails d'une boîte partagée (info@…) restent à l'entreprise : l'équipe les voyait déjà.
-- Rejouable. Les emails orphelins d'avant cette migration ne se distinguent plus de ceux de la capture : inchangés.
alter table email_messages add column if not exists orphaned_private boolean not null default false;

create or replace function mailbox_private_messages() returns trigger language plpgsql as $$
begin
  if not old.shared then
    delete from email_messages where mailbox_id = old.id and (status <> 'linked' or project_id is null);
    update email_messages set orphaned_private = true where mailbox_id = old.id;
  end if;
  return old;
end $$;

drop trigger if exists mailbox_private_messages on mailboxes;
create trigger mailbox_private_messages before delete on mailboxes
  for each row execute function mailbox_private_messages();
