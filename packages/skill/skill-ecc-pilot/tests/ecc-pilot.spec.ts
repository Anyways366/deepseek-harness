/** Phase E1: the pinned ECC skill pilot. @module @deepseek-ai/dsh-skill-ecc-pilot */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry, { ImportedSkillBoundError, MAX_IMPORTED_SKILL_BODY_BYTES, renderSkillContent } from '@deepseek-ai/dsh-skill'
import type { SkillDefinition } from '@deepseek-ai/dsh-skill'
import * as pilot from '../src/index.ts'
import { EccPilotIntegrityError, verifyArtifactText } from '../src/index.ts'
import { ECC_PILOT_PROVENANCE, ECC_PILOT_SKILL_NAME } from '../src/provenance.ts'

const ARTIFACT = fileURLToPath(new URL('../vendored/coding-standards/SKILL.md', import.meta.url))

async function boot() {
  const ctx = new Context()
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(pilot)
  return ctx
}

function withBody(content: string): SkillDefinition {
  return {
    name: 'synthetic',
    description: 'synthetic boundary fixture',
    invocation: { modelInvocable: true, userInvocable: false },
    provider: 'ecc-pilot',
    source: 'bundled',
    provenance: ECC_PILOT_PROVENANCE,
    content,
  }
}

describe('E1 provenance pin', () => {
  it('records the verified upstream identity and digests', () => {
    expect(ECC_PILOT_PROVENANCE.repository).toBe('affaan-m/ECC')
    expect(ECC_PILOT_PROVENANCE.commit).toBe('b92f181b3b748d1abbc2afd94af6aa7d8c8fca29')
    expect(ECC_PILOT_PROVENANCE.path).toBe('skills/coding-standards/SKILL.md')
    expect(ECC_PILOT_PROVENANCE.license).toBe('MIT')
    expect(ECC_PILOT_PROVENANCE.rawBytes).toBe(12866)
    expect(ECC_PILOT_PROVENANCE.rawSha256).toBe('e80544c3d1eac5b14f22022146bd91a6b0ecc30e099cf5181894853aeb81dee1')
    expect(ECC_PILOT_PROVENANCE.bodyBytes).toBe(12528)
    expect(ECC_PILOT_PROVENANCE.bodySha256).toBe('50dff1c00e4e65cae9837e2e94d6d08a3da35c01a017980079b58f40e9e30313')
  })

  it('loads the vendored artifact as the pinned skill', async () => {
    const definition = verifyArtifactText(await readFile(ARTIFACT, 'utf8'))
    expect(definition.name).toBe(ECC_PILOT_SKILL_NAME)
    expect(Buffer.byteLength(definition.content, 'utf8')).toBe(ECC_PILOT_PROVENANCE.bodyBytes)
    expect(definition.provenance).toEqual(ECC_PILOT_PROVENANCE)
    expect(definition.invocation).toEqual({ modelInvocable: true, userInvocable: false })
  })

  it('refuses a shortened artifact', async () => {
    const raw = await readFile(ARTIFACT, 'utf8')
    expect(() => verifyArtifactText(raw.slice(0, raw.length - 1))).toThrow(EccPilotIntegrityError)
  })

  it('refuses a same-named substitute with different bytes', async () => {
    const raw = await readFile(ARTIFACT, 'utf8')
    const substituted = raw.replace('# Coding Standards & Best Practices', '# Coding Standards & Best Practises')
    expect(substituted).not.toBe(raw)
    expect(() => verifyArtifactText(substituted)).toThrow(EccPilotIntegrityError)
  })

  it('refuses content with no frontmatter', () => {
    expect(() => verifyArtifactText('no frontmatter here')).toThrow(EccPilotIntegrityError)
  })
})

describe('E1 registry integration', () => {
  it('advertises the approved skill as model-only invocable', async () => {
    const ctx = await boot()
    const entry = (await ctx.skills.list({})).find(skill => skill.name === ECC_PILOT_SKILL_NAME)
    expect(entry).toBeDefined()
    expect(entry?.invocation).toEqual({ modelInvocable: true, userInvocable: false })
    expect(entry?.provenance?.commit).toBe(ECC_PILOT_PROVENANCE.commit)
  })

  it('loads the pinned body through the registry lookup', async () => {
    const ctx = await boot()
    const skill = await ctx.skills.get(ECC_PILOT_SKILL_NAME, {})
    expect(skill).toBeDefined()
    expect(Buffer.byteLength(skill!.content, 'utf8')).toBe(ECC_PILOT_PROVENANCE.bodyBytes)
    expect(skill!.provenance?.bodySha256).toBe(ECC_PILOT_PROVENANCE.bodySha256)
  })

  it('renders through the shared skill-content boundary', async () => {
    const ctx = await boot()
    const skill = await ctx.skills.get(ECC_PILOT_SKILL_NAME, {})
    const rendered = renderSkillContent(skill!)
    expect(rendered).toContain(skill!.content)
    expect(rendered).toContain('<skill_instructions>')
  })

  it('declares only the skills service, so it cannot register tools', () => {
    expect(pilot.inject).toEqual(['skills'])
  })
})

describe('E1 imported-content bound', () => {
  it('accepts 16383 and exactly 16384 bytes', () => {
    expect(renderSkillContent(withBody('a'.repeat(MAX_IMPORTED_SKILL_BODY_BYTES - 1)))).toContain('<skill_content')
    expect(renderSkillContent(withBody('a'.repeat(MAX_IMPORTED_SKILL_BODY_BYTES)))).toContain('<skill_content')
  })

  it('refuses 16385 bytes', () => {
    expect(() => { renderSkillContent(withBody('a'.repeat(MAX_IMPORTED_SKILL_BODY_BYTES + 1))) }).toThrow(ImportedSkillBoundError)
  })

  it('measures UTF-8 bytes rather than characters', () => {
    expect(Buffer.byteLength('\u00e9'.repeat(8192), 'utf8')).toBe(MAX_IMPORTED_SKILL_BODY_BYTES)
    expect(renderSkillContent(withBody('\u00e9'.repeat(8192)))).toContain('<skill_content')
    expect(() => { renderSkillContent(withBody('\u00e9'.repeat(8192) + 'a')) }).toThrow(ImportedSkillBoundError)
  })

  it('leaves locally authored skills unbounded', () => {
    const local = {
      name: 'local',
      description: 'local skill',
      invocation: { modelInvocable: true, userInvocable: true },
      provider: 'local',
      source: 'project' as const,
      content: 'b'.repeat(MAX_IMPORTED_SKILL_BODY_BYTES + 4096),
    }
    expect(renderSkillContent(local)).toContain('<skill_content')
  })
})
