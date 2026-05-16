import { join } from 'node:path'

export const SHARED_ROOT = process.env['SHARED_ROOT'] ?? '/shared'
export const WORK_ROOT = join(SHARED_ROOT, 'work')
export const DOCS_ROOT = join(SHARED_ROOT, 'yeap-docs')
