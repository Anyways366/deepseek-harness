/**
 * The pinned Everything Claude Code artifact this pilot vendors, recorded as typed
 * constants so the pin and its expected digests are reviewable in one place.
 * @module @deepseek-ai/dsh-skill-ecc-pilot/provenance
 */

import type { SkillProvenance } from '@deepseek-ai/dsh-skill'

/** Logical skill identifier this pilot registers. */
export const ECC_PILOT_SKILL_NAME = 'coding-standards'

/**
 * Provenance of the vendored artifact. Every digest is over the exact bytes this
 * package loads; a mismatch is a hard failure, never a warning.
 */
export const ECC_PILOT_PROVENANCE: SkillProvenance = {
  repository: 'affaan-m/ECC',
  commit: 'b92f181b3b748d1abbc2afd94af6aa7d8c8fca29',
  path: 'skills/coding-standards/SKILL.md',
  rawSha256: 'e80544c3d1eac5b14f22022146bd91a6b0ecc30e099cf5181894853aeb81dee1',
  rawBytes: 12866,
  bodySha256: '50dff1c00e4e65cae9837e2e94d6d08a3da35c01a017980079b58f40e9e30313',
  bodyBytes: 12528,
  license: 'MIT',
  attribution: 'Copyright (c) 2026 Affaan Mustafa - Everything Claude Code (affaan-m/ECC), MIT License',
}
