// Toutes les parties de la langue « it », réunies en un seul fichier chargé à la demande (src/i18n/index.tsx).
const parts = import.meta.glob<Record<string, string>>('../locales/it/*.json', { eager: true, import: 'default' })
export default Object.assign({}, ...Object.values(parts)) as Record<string, string>
