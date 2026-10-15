# 项目级 skills（通用教程）

放**跨世界通用的手艺**：怎么生图、怎么用组件叙事、怎么给角色选音色、怎么控制揭示节奏、怎么把叙事和玩法（骰子 / 以物解谜 / choice）咬合起来。

与世界级 skills 的分工：

| 层 | 位置 | 放什么 |
|---|---|---|
| 项目级（本目录） | `<repo>/skills/` | 通用教程——所有世界共享的手艺 |
| 世界级 | `<world>/skills/`（与 `world/` 同级） | 这个世界自己的文风、剧情；随世界包分发 |

两层在启动作家进程时一起用 `--skill <dir>` 传入（见 `apps/server/src/engine/presets.ts` 的 `skillArgs`），目录不存在就不传，零成本。

## 写一个 skill

一个 skill = 一个含 `SKILL.md` 的目录，会被递归发现：

```
skills/
  component-narration/
    SKILL.md            # frontmatter 必须有 name 与 description
    references/         # 按需加载的详细文档
```

> **目录名与 `name` 一律 ASCII 小写 kebab-case**（`AGENTS.md` §1.1）——**平台级与世界级都是英文**。
> 世界语言只影响 `SKILL.md` 的**正文与 `description`**（世界内容），不影响目录名与 `name`（程序标识符）。
> 世界级用世界目录名作前缀：`holmes-world-style`，不是 `holmes-beckstreet-style`。

`SKILL.md` 的 frontmatter 只有两个必填字段：

```yaml
---
name: component-narration        # 小写字母 / 数字 / 连字符，<=64 字符
description: Use when choosing what carries a piece of the scene — when plain chalk is enough, when the thing must be a note the player can pick up, and when it must be a sealed letter that opens into a second layer.
---
```

**`description` 决定作家什么时候会去读它**，要写得具体——system prompt 里常驻的只有这一行，正文由作家按需 `read`（渐进披露）。完整规范见 `vendor/pi-rp/packages/coding-agent/docs/skills.md`。

**正文只放判据，长表放 `references/`**（渐进披露）：`SKILL.md` 回答"怎么选"，`references/*.md` 回答"这个 kind 的字段叫什么"；正文引用时写相对路径（`read references/xxx.md`）。

## 为什么是 skill 而不是隐藏字段

作家知道而玩家不必关心的东西（剧情、手法、节奏），一律走 skill，不要发明"只注入作家 prompt、玩家看不到"的字段。隐藏字段要求引擎在四个地方同时保持正确（manifest 加字段 / 导出时剥掉 / 前端永不读 / 注入时记得拼），最后会把作家与玩家的关系做成信息攻防；skill 是零引擎改动、可复用、可组合的手艺包。
