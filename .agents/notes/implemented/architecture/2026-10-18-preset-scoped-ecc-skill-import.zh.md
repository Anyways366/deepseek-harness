# Agent Note: 预设作用域的 ECC 技能导入

Status: implemented

[English](2026-10-18-preset-scoped-ecc-skill-import.md) | 中文

## 问题

DSH 可以从多个提供方加载技能,但迄今为止每一个提供方要么读取部署自有的目录,要么随 harness 本身一同发布。导入第三方技能文件会引出既有提供方尚未回答的问题:导入的字节如何固定、谁授权模型加载它们、导入的正文允许多大,以及本笔记所负责的问题——**究竟哪些 agent 能看到它**。

把这样的提供方挂载进 base bundle 会错误地回答最后一个问题。一个被所有 profile 继承的 preset 会把导入的第三方技能放进每个 agent 的目录,包括那些其工作与导入内容毫无关系的 agent。

## 决策

固定版本的 ECC 提供方作为独立包发布:`@deepseek-ai/dsh-skill-ecc-pilot`,并且由**恰好一个 agent preset**挂载:声明于 `packages/bundle/web-app/presets/ptc.patch.yml` 的 `ptc` preset。一行配置加入其既有的 skills 段落,位于 `skill-filesystem` 与 `tool-skill` 之侧:

```yaml
- id: skill-ecc-pilot
  name: '@deepseek-ai/dsh-skill-ecc-pilot'
```

技能注册表位于 host 组合中并按作用域分层,因此该行会注册进 `ptc` preset 自己的那一层。该提供方不发布任何服务,因此不会贡献任何会被"进程级全局服务"不变式拒绝的东西。`packages/bundle/web-app/package.json` 将该包声明为 `workspace:*` 依赖,以便该行的裸包名能从 harness base 解析;`tsconfig.base.json` 把该包名映射到其源码,供 vitest 使用的解析门面使用。

其他所有 preset——`standard`、`cordis`——均未被改动,因此无法发现或加载该导入技能。该提供方绝不会挂载到 base bundle、host 或进程级全局作用域,也不会挂载到被所有 preset 继承的组合中;没有任何 ECC 内容被复制进全局技能目录。

**调用授权来自提供方自身的常量,而非文件 frontmatter。** 文件系统解析器是 fail-open 的:当不存在策略键时,它返回 `{ modelInvocable: true, userInvocable: true }`。vendored 的 ECC 文件不含任何策略键,因此通过文件系统提供方加载它会使它同时出现在面向人的路径上。pilot 改为在可信代码中声明 `{ modelInvocable: true, userInvocable: false }`,并在其生成的每个定义上返回该策略;导入的 frontmatter 仅用于解析标识与描述,永远无法扩大白名单。

**任何内容返回之前都会先做完整性校验。** `verifyArtifactText` 按顺序拒绝:原始长度不等于 12,866 字节;原始 SHA-256 不等于 `e80544c3d1eac5b14f22022146bd91a6b0ecc30e099cf5181894853aeb81dee1`;frontmatter 缺失或无法解析;声明的 name 不是 `coding-standards`;description 缺失;解析后的正文不等于 12,528 字节或其 SHA-256 不等于 `50dff1c00e4e65cae9837e2e94d6d08a3da35c01a017980079b58f40e9e30313`;以及正文超过 16,384 字节的导入内容上限。每一次拒绝都会抛出 `EccPilotIntegrityError` 且不注册任何东西,因此产物缺失或被改动会显式失败,而不会呈现一个空的或未经校验的技能。`list()` 与 `get()` 都会重新读取并重新校验,因此被哈希的字节就是被投递的字节。

**导入内容上限在共享的渲染边界处强制执行。** `@deepseek-ai/dsh-skill` 中的 `renderSkillContent` 在携带 provenance 的正文超过 `MAX_IMPORTED_SKILL_BODY_BYTES`(16,384)时抛出 `ImportedSkillBoundError`。工具结果与用户调用注入都汇聚到这一个函数,因此没有任何替代调用路径能投递超大的导入正文。本地编写的技能一如既往不受限制,因为它们不携带 provenance;`SkillProvenance` 是可选字段,因此经由 `runtimeCandidate` 与 `toSummary` 传递它的那些投影不会改变任何既有技能形状。

**测试。** pilot 自身的测试套件覆盖了固定值、标识与描述拒绝、摘要错误与被改动来源的拒绝、显式策略,以及上限之下/刚好/之上的边界(含多字节 UTF-8)。预设作用域本身由本仓库的 `@deepseek-ai/dsh-agent-preset-registry` 测试套件覆盖,它在不同作用域间挂载真实 preset;本次改动只是向既有 preset 添加一行,而不是引入新的作用域机制,行的位置正是限制可见性的东西。

## 曾考虑的替代方案

**挂载到 base bundle,让每个 agent 都获得它。** 已否决:被所有 preset 继承的 base 或 profile 组合正是本设计要防止的泄漏——无关 agent 的目录会带上它毫无用处的第三方内容。

**新增一个 ECC 专用的第二个导入器包。** 已否决:一个提供方已经实现了固定、完整性校验、大小上限与显式策略。第二个导入器会复制安全面,并制造两处可能发生固定漂移的地方。

**把 vendored 的 `SKILL.md` 复制进全局文件系统技能根目录,而不是挂载提供方。** 已否决:文件系统提供方在调用策略上是 fail-open 的,而且没有固定值,因此被复制的文件会既可被人类调用又未经校验——恰好削弱了导入内容上限所依赖的那些保证。

**为该提供方给 preset 加一个 `isolate` realm。** 已否决,既无必要也不正确:该提供方不提供任何服务,而技能注册表已按作用域分层,因此 realm 只会把工具所需的 host 注册表藏起来,而不会增加隔离。

**依赖引擎的默认调用策略。** 已否决:默认值是 `true/true`。导入内容不得自行决定其授权,因此策略写在代码中。

## 后果

由 `ptc` 组合出的编码 agent 获得一个导入技能;其他所有 preset 不受影响。部署方只需在一处推断导入内容,且导入字节一旦被改动就会触发显式的完整性错误,而不会静默改变模型读到的东西。

代价是该导入技能对面向人的调用路径不可见。这是刻意的:导入的第三方正文应当只在另一项决定授权该界面之后才交到人手中。希望在其他 preset 中使用该技能的部署必须自行添加该行;不会继承任何东西。

有一处差异被记录而非被解决:pilot 使用 `js-yaml` 解析 frontmatter,而 `dsh-skill-filesystem` 使用 `yaml`。两者对该产物的 frontmatter 解析结果一致,且两个实现都以同样的分隔符遍历定位正文,因此无论哪个库读取元数据,固定正文摘要都相同。风险由固定值而非由库来界定:即便某个产物的元数据会被两个库读出不同结果,它仍必须匹配所记录的原始摘要与正文摘要才会被投递。统一该依赖仍有待完成。
