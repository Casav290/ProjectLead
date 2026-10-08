declare module 'virtual:assets' {
  const assets: Record<string, { type: string; body: string }>
  export default assets
}
declare module 'virtual:migrations' {
  const migrations: { name: string; sql: string }[]
  export default migrations
}
declare module 'virtual:media' {
  const media: import('./lib/media.js').MediaManifest
  export default media
}
