// The in-frame data SDK as the renderer serves it (backend/app/services/
// artifact_db_sdk.js), read from disk so the tests run the real thing.
// Vitest runs from frontend/, the package root.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const DATA_SDK = readFileSync(resolve(process.cwd(), '../backend/app/services/artifact_db_sdk.js'), 'utf8')
