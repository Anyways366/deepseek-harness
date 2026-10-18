# Agent Note: Preset-scoped ECC skill import

Status: implemented

English | [中文](2026-10-18-preset-scoped-ecc-skill-import.zh.md)

## Problem

DSH can load skills from several providers, but every one of them either reads a directory the deployment owns or ships inside the harness itself. Importing a third-party skill file raises questions the existing providers do not answer: how the imported bytes are pinned, who authorizes the model to load them, how large an imported body may be, and — the question this note owns — **which agents can see it at all**.

Mounting such a provider in the base bundle would answer the last question wrongly. A preset that every profile inherits would put an imported third-party skill in the catalog of every agent, including agents whose work has nothing to do with the imported content.

## Decision

The pinned ECC provider ships as its own package, `@deepseek-ai/dsh-skill-ecc-pilot`, and is mounted by **exactly one agent preset**: the `ptc` preset, declared in `packages/bundle/web-app/presets/ptc.patch.yml`. One row joins its existing skills section, beside `skill-filesystem` and `tool-skill`:

```yaml
- id: skill-ecc-pilot
  name: '@deepseek-ai/dsh-skill-ecc-pilot'
```

The skill registry lives in the host composition and is layered per scope, so this row registers into the `ptc` preset's layer of it. The provider publishes no service, so it contributes nothing the process-global-service invariant could reject. `packages/bundle/web-app/package.json` declares the package as a `workspace:*` dependency so the row's bare name resolves from the harness base, and `tsconfig.base.json` maps the package name to its source for the resolution facade vitest uses.

Every other preset — `standard`, `cordis` — is untouched and therefore cannot discover or load the imported skill. The provider is never mounted in the base bundle, in a host or process-global scope, or in a composition inherited by all presets, and no ECC content is copied into a global skill directory.

**Invocation authority is the provider's own constant, not the file's frontmatter.** The filesystem parser is fail-open: with no policy keys present, it returns `{ modelInvocable: true, userInvocable: true }`. The vendored ECC file carries no policy keys, so loading it through the filesystem provider would make it available on the human-facing path too. The pilot instead states `{ modelInvocable: true, userInvocable: false }` in trusted code and returns that on every definition it produces; imported frontmatter is parsed for identity and description only and can never widen the allowlist.

**Integrity is checked before any content is returned.** `verifyArtifactText` refuses, in order: a raw length other than 12,866 bytes; a raw SHA-256 other than `e80544c3d1eac5b14f22022146bd91a6b0ecc30e099cf5181894853aeb81dee1`; a missing or unparsable frontmatter block; a declared name other than `coding-standards`; a missing description; a parsed body other than 12,528 bytes or with a SHA-256 other than `50dff1c00e4e65cae9837e2e94d6d08a3da35c01a017980079b58f40e9e30313`; and a body above the 16,384-byte imported-content bound. Every refusal throws `EccPilotIntegrityError` and registers nothing, so a missing or altered artifact fails visibly instead of presenting an empty or unverified skill. Both `list()` and `get()` re-read and re-verify, so the bytes hashed are the bytes delivered.

**The imported-content bound is enforced at the shared render boundary.** `renderSkillContent` in `@deepseek-ai/dsh-skill` throws `ImportedSkillBoundError` when a provenance-carrying body exceeds `MAX_IMPORTED_SKILL_BODY_BYTES` (16,384). Both the tool result and the user-invocation injection funnel through that one function, so no alternate call path can deliver an oversized imported body. Locally authored skills are unbounded as before, because they carry no provenance; `SkillProvenance` is an optional field, so the projections that carry it through `runtimeCandidate` and `toSummary` leave every existing skill shape unchanged.

**Testing.** The pilot's own suite covers the pin, the identity and description refusals, the wrong-digest and altered-source refusals, the explicit policy, and the below/at/above-limit boundaries including multibyte UTF-8. Preset scoping itself is covered by this repository's `@deepseek-ai/dsh-agent-preset-registry` suite, which mounts real presets across scopes; this change adds one row to an existing preset rather than new scoping machinery, and the row's placement is what restricts visibility.

## Alternatives considered

**Mount it in the base bundle so every agent gets it.** Rejected: a base or profile composition inherited by every preset is precisely the leak this design exists to prevent — an unrelated agent's catalog would carry third-party content it has no use for.

**Add a second, ECC-specific importer package.** Rejected: one provider already implements the pin, the integrity checks, the size bound, and the explicit policy. A second importer would duplicate the security surface and create two places for the pin to drift.

**Copy the vendored `SKILL.md` into a global filesystem skill root instead of mounting a provider.** Rejected: the filesystem provider is fail-open on invocation policy and has no pin, so the copied file would be human-invocable and unverified — weakening exactly the guarantees the imported-content limit depends on.

**Give the preset an `isolate` realm for the provider.** Rejected as unnecessary and wrong: the provider provides no service, and the skill registry is already layered per scope, so a realm would hide the host registry the tool needs rather than adding isolation.

**Rely on the engine's default invocation policy.** Rejected: the default is `true/true`. Imported content must not choose its own authorization, so the policy is stated in code.

## Consequences

A coding agent composed from `ptc` gains one imported skill; every other preset is unaffected. The deployment keeps a single place to reason about imported content, and the imported bytes cannot be changed without failing a visible integrity error rather than silently altering what the model reads.

The cost is that the imported skill is invisible to the human-facing invocation path. That is deliberate: an imported third-party body should reach a person only after a separate decision authorizes that surface. A deployment that wants the skill in a different preset must add the row itself; nothing is inherited.

One divergence remains, recorded rather than resolved: the pilot parses frontmatter with `js-yaml` while `dsh-skill-filesystem` uses `yaml`. The two agree on this artifact's frontmatter, and the body is located by the same delimiter walk in both implementations, so the pinned body digest matches whichever library reads the metadata. The risk is bounded by the pin rather than by the library: an artifact whose metadata the two libraries read differently would still have to match the recorded raw and body digests to be served. Unifying the dependency remains open.
