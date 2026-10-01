import { Field, Input, Select, Textarea } from '../ui'
import type { Client } from '../../lib/types'

/** Les champs d'une fiche client, communs à la création et à l'édition. */

export type ClientDraft = {
  kind: 'company' | 'person'; name: string; contact_person: string; email: string; phone: string
  street: string; building_number: string; postal_code: string; town: string; country: string; language: string
  vat_number: string; notes: string
}

export const emptyClient = (): ClientDraft => ({
  kind: 'company', name: '', contact_person: '', email: '', phone: '', street: '', building_number: '',
  postal_code: '', town: '', country: 'CH', language: 'fr', vat_number: '', notes: '',
})

export const clientToDraft = (c: Client): ClientDraft => ({
  kind: c.kind, name: c.name, contact_person: c.contact_person ?? '', email: c.email ?? '', phone: c.phone ?? '',
  street: c.street ?? '', building_number: c.building_number ?? '', postal_code: c.postal_code ?? '', town: c.town ?? '',
  country: c.country || 'CH', language: c.language || 'fr', vat_number: c.vat_number ?? '', notes: c.notes ?? '',
})

/** Les champs vides partent en `null` : le serveur efface plutôt que de garder une chaîne vide. */
export const draftToBody = (d: ClientDraft) => {
  const t = (s: string) => s.trim() || null
  return {
    kind: d.kind, name: d.name.trim(), contact_person: t(d.contact_person), email: d.email.trim(), phone: t(d.phone),
    street: t(d.street), building_number: t(d.building_number), postal_code: t(d.postal_code), town: t(d.town),
    country: d.country, language: d.language, vat_number: t(d.vat_number), notes: t(d.notes),
  }
}

export const COUNTRIES: Record<string, string> = {
  CH: 'Suisse', FR: 'France', DE: 'Allemagne', IT: 'Italie', AT: 'Autriche', LI: 'Liechtenstein', BE: 'Belgique',
  LU: 'Luxembourg', NL: 'Pays-Bas', ES: 'Espagne', PT: 'Portugal', GB: 'Royaume-Uni', US: 'États-Unis',
}
export const LANGUAGES: Record<string, string> = { fr: 'Français', de: 'Allemand', it: 'Italien', en: 'Anglais' }

export function ClientFields({ value, onChange }: { value: ClientDraft; onChange: (d: ClientDraft) => void }) {
  const set = <K extends keyof ClientDraft>(k: K, v: ClientDraft[K]) => onChange({ ...value, [k]: v })
  const company = value.kind === 'company'
  return (
    <div className="grid gap-3 sm:grid-cols-6">
      <div className="flex gap-0 sm:col-span-6" role="radiogroup" aria-label="Type de client">
        {(['company', 'person'] as const).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={value.kind === k} onClick={() => set('kind', k)}
            className={`flex-1 border px-3 py-2 text-[13px] font-bold ${value.kind === k ? 'border-accent bg-accent-veil text-accent-dark' : 'border-input bg-card text-muted-foreground hover:text-foreground'}`}>
            {k === 'company' ? 'Société' : 'Personne'}
          </button>
        ))}
      </div>
      <Field label={company ? 'Nom de la société' : 'Nom et prénom'} className="sm:col-span-6">
        <Input value={value.name} onChange={(e) => set('name', e.target.value)} required maxLength={200} />
      </Field>
      {company && (
        <Field label="Personne de contact" className="sm:col-span-6">
          <Input value={value.contact_person} onChange={(e) => set('contact_person', e.target.value)} maxLength={200} />
        </Field>
      )}
      <Field label="Email" className="sm:col-span-3">
        <Input type="email" value={value.email} onChange={(e) => set('email', e.target.value)} />
      </Field>
      <Field label="Téléphone" className="sm:col-span-3">
        <Input type="tel" value={value.phone} onChange={(e) => set('phone', e.target.value)} maxLength={50} />
      </Field>
      <Field label="Rue" className="sm:col-span-4">
        <Input value={value.street} onChange={(e) => set('street', e.target.value)} maxLength={70} autoComplete="address-line1" />
      </Field>
      <Field label="Numéro" className="sm:col-span-2">
        <Input value={value.building_number} onChange={(e) => set('building_number', e.target.value)} maxLength={16} />
      </Field>
      <Field label="NPA" className="sm:col-span-2">
        <Input value={value.postal_code} onChange={(e) => set('postal_code', e.target.value)} maxLength={16} autoComplete="postal-code" />
      </Field>
      <Field label="Localité" className="sm:col-span-4">
        <Input value={value.town} onChange={(e) => set('town', e.target.value)} maxLength={35} autoComplete="address-level2" />
      </Field>
      <Field label="Pays" className="sm:col-span-2">
        <Select value={value.country} onChange={(e) => set('country', e.target.value)}>
          {!COUNTRIES[value.country] && <option value={value.country}>{value.country}</option>}
          {Object.entries(COUNTRIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </Field>
      <Field label="Langue" className="sm:col-span-2">
        <Select value={value.language} onChange={(e) => set('language', e.target.value)}>
          {Object.entries(LANGUAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </Field>
      <Field label="N° TVA" className="sm:col-span-2">
        <Input value={value.vat_number} onChange={(e) => set('vat_number', e.target.value)} maxLength={40} placeholder="CHE-123.456.789 TVA" />
      </Field>
      <Field label="Notes" className="sm:col-span-6">
        <Textarea rows={3} value={value.notes} onChange={(e) => set('notes', e.target.value)} maxLength={5000} />
      </Field>
    </div>
  )
}

/** « Rue 12, 1003 Lausanne » ; le pays seulement hors de Suisse. */
export const addressLine = (c: Pick<Client, 'street' | 'building_number' | 'postal_code' | 'town' | 'country'>) => {
  const street = [c.street, c.building_number].filter(Boolean).join(' ')
  const town = [c.postal_code, c.town].filter(Boolean).join(' ')
  return [street, town, c.country && c.country !== 'CH' ? COUNTRIES[c.country] ?? c.country : ''].filter(Boolean).join(', ')
}

export const isFromCrmlead = (c: Pick<Client, 'external_ref'>) => Boolean(c.external_ref?.startsWith('crmlead:'))
