# 月下之誓

一段原创的骑士誓约故事。左边站着一位黑发男性旅人，右边是一位银发女骑士。玩家自行决定自己的名字和愿望。本版本使用简体中文。

- 开场：world/README.md、一个 world/opening.md Chalk 和一个物品 world/blue-ribbon.md。
- 一张 CG 同时用作封面和开场背景。没有单独的立绘、NPC 卡片、视频或第二段介绍。
- BGM：平台主题 emberglass，nicorico_120 创作的 Mystical/fantasy 循环曲，CC0。完整致谢见仓库中的 assets/audio/CREDITS.md。
- 选择同意并出发，检查 Writer 输入后按 Send。Writer 会更新丝带并创建 world/moonlit-courtyard。玩家打开它的新门。
- 每个新场景包含其 README、一个开场 Chalk、一个物品和一张背景。只有当玩家明确要求继续时，才会生成下一个地点。不进行递归生成。
- 可使用层级导航，或请 Writer 返回已知的上层。之前的场景保持原样。

## 开始与限制

打开 http://localhost:5173/，选择 **月下之誓 · 中文**，然后新建存档。请先在连接设置中配置 Writer 和图像服务。

模板中不附带存档专用设置。如有需要，请在新存档的设置中启用场景初始化。普通选项只会准备 Writer 输入；检查后按 Send 才会请求生成。

世界的扩展由 world skill 和 Chalk 的 intent 驱动，而不是后台任务或无限预生成。如果图像生成失败，保留已完成的文本，并说明如何请求重新尝试。打包检查并不能证明真实的 Agent 已经生成了后续场景。实际测试记录请参阅内部玩法文档。
