import { serve } from '@hono/node-server'
const { default: fn } = await import(process.cwd() + '/deploy/neon/index.mjs')
serve({ fetch: (r) => fn.fetch(r), port: 3998 }, () => console.log('ok'))
