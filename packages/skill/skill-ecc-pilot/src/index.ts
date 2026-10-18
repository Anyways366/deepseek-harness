/**
 * Pinned Everything Claude Code skill pilot provider.
 *
 * Registers exactly one imported skill and refuses to deliver it unless the vendored
 * artifact still matches its recorded provenance pin. It reuses the existing
 * `ctx.skills` registry and the `skill` tool's loading path; it adds no second
 * registry, no runtime download, and no executable capability.
 * @module @deepseek-ai/dsh-skill-ecc-pilot
 */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'
import type { Context } from '@deepseek-ai/cordis'
import { BUNDLED_SKILL_RANK, MAX_IMPORTED_SKILL_BODY_BYTES } from '@deepseek-ai/dsh-skill'
import type {
  SkillCandidate,
  SkillDefinition,
  SkillInvocationPolicy,
  SkillProvider,
} from '@deepseek-ai/dsh-skill'
import { ECC_PILOT_PROVENANCE, ECC_PILOT_SKILL_NAME } from './provenance.ts'

export { ECC_PILOT_PROVENANCE, ECC_PILOT_SKILL_NAME } from './provenance.ts'

/** Cordis plugin name. */
export const name = 'skill-ecc-pilot'
/** Service required by this provider. */
export const inject = ['skills']

const PROVIDER_NAME = 'ecc-pilot'
const ARTIFACT_PATH = fileURLToPath(new URL('../vendored/coding-standards/SKILL.md', import.meta.url))

/**
 * Invocation authority for imported content, stated explicitly rather than inherited
 * from the registry default. The model-facing skill tool may load the pilot; the
 * human-facing surface stays closed because an imported body should not reach it
 * until a separate decision authorizes that path.
 */
const PILOT_INVOCATION: SkillInvocationPolicy = { modelInvocable: true, userInvocable: false }

/** Raised when the vendored artifact no longer satisfies its recorded pin. */
export class EccPilotIntegrityError extends Error {
  /**
   * @param message - which recorded expectation the artifact violated.
   */
  constructor(message: string) {
    super(message)
    this.name = 'EccPilotIntegrityError'
  }
}

/**
 * @param bytes - bytes to digest.
 * @returns lowercase hex SHA-256.
 */
function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Split YAML frontmatter from a skill file exactly as `dsh-skill-filesystem` does,
 * so the body hashed here is the same string DSH would deliver to a model.
 * @param raw - the complete skill file text.
 * @returns parsed frontmatter data and the raw body, or `undefined` when absent.
 */
function splitFrontmatter(raw: string): { data: Record<string, unknown>; body: string } | undefined {
  const firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd < 0) return undefined
  if (raw.slice(0, firstLineEnd).replace(/\r$/, '') !== '---') return undefined
  let lineStart = firstLineEnd + 1
  while (lineStart <= raw.length) {
    const nextNewline = raw.indexOf('\n', lineStart)
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline
    if (raw.slice(lineStart, lineEnd).replace(/\r$/, '') === '---') {
      const bodyStart = nextNewline < 0 ? raw.length : nextNewline + 1
      const parsed = yaml.load(raw.slice(firstLineEnd + 1, lineStart))
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
      return { data: parsed as Record<string, unknown>, body: raw.slice(bodyStart) }
    }
    if (nextNewline < 0) return undefined
    lineStart = nextNewline + 1
  }
  return undefined
}

/**
 * Verify artifact text against the pin and build the skill it describes.
 *
 * Every recorded expectation is checked before any content is returned, so a changed
 * byte, a swapped file, a mismatched identity, or an oversized body is refused rather
 * than delivered. Exported so tests can exercise each refusal without modifying the
 * vendored artifact.
 * @param raw - artifact text to verify.
 * @returns the verified skill definition carrying its provenance.
 * @throws {EccPilotIntegrityError} when any recorded expectation is violated.
 */
export function verifyArtifactText(raw: string): SkillDefinition {
  const rawBytes = Buffer.from(raw, 'utf8')
  if (rawBytes.byteLength !== ECC_PILOT_PROVENANCE.rawBytes) {
    throw new EccPilotIntegrityError(
      `vendored artifact is ${String(rawBytes.byteLength)} bytes, expected ${String(ECC_PILOT_PROVENANCE.rawBytes)}`,
    )
  }
  if (sha256Hex(rawBytes) !== ECC_PILOT_PROVENANCE.rawSha256) {
    throw new EccPilotIntegrityError('vendored artifact does not match the pinned raw SHA-256')
  }
  const parsed = splitFrontmatter(raw)
  if (parsed === undefined) {
    throw new EccPilotIntegrityError('vendored artifact has no parsable YAML frontmatter')
  }
  const declared = parsed.data['name']
  if (typeof declared !== 'string' || declared !== ECC_PILOT_SKILL_NAME) {
    throw new EccPilotIntegrityError('vendored artifact declares an unexpected skill identity')
  }
  const description = parsed.data['description']
  if (typeof description !== 'string' || description.length === 0) {
    throw new EccPilotIntegrityError('vendored artifact declares no usable description')
  }
  const body = parsed.body.trim()
  const bodyBytes = Buffer.byteLength(body, 'utf8')
  if (bodyBytes !== ECC_PILOT_PROVENANCE.bodyBytes) {
    throw new EccPilotIntegrityError(
      `parsed body is ${String(bodyBytes)} bytes, expected ${String(ECC_PILOT_PROVENANCE.bodyBytes)}`,
    )
  }
  if (sha256Hex(Buffer.from(body, 'utf8')) !== ECC_PILOT_PROVENANCE.bodySha256) {
    throw new EccPilotIntegrityError('parsed body does not match the pinned body SHA-256')
  }
  if (bodyBytes > MAX_IMPORTED_SKILL_BODY_BYTES) {
    throw new EccPilotIntegrityError(
      `parsed body is ${String(bodyBytes)} bytes, above the ${String(MAX_IMPORTED_SKILL_BODY_BYTES)}-byte imported-content limit`,
    )
  }
  return {
    name: declared,
    description,
    invocation: PILOT_INVOCATION,
    provider: PROVIDER_NAME,
    source: 'bundled',
    provenance: ECC_PILOT_PROVENANCE,
    content: body,
  }
}

/**
 * Read the vendored artifact and verify it against the pin.
 * @returns the verified skill definition.
 */
async function loadVerified(): Promise<SkillDefinition> {
  return verifyArtifactText(await readFile(ARTIFACT_PATH, 'utf8'))
}

const provider: SkillProvider = {
  name: PROVIDER_NAME,
  async list(): Promise<SkillCandidate[]> {
    const definition = await loadVerified()
    return [{
      name: definition.name,
      description: definition.description,
      invocation: definition.invocation,
      provider: definition.provider,
      source: definition.source,
      ...definition.provenance === undefined ? {} : { provenance: definition.provenance },
      rank: BUNDLED_SKILL_RANK,
      locator: ARTIFACT_PATH,
    }]
  },
  get: () => loadVerified(),
}

/**
 * Register the pinned ECC pilot provider on `ctx.skills`.
 * @param ctx - Cordis context carrying the skill registry.
 */
export function apply(ctx: Context): void {
  ctx.skills.registerProvider(() => provider)
}
