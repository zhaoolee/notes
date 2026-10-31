# 2026-10-31：多图便签输入性能

- 图片 React key 不能包含 `markerStart`：前文每输入一个字符都会改变后续图片偏移，
  导致所有后续图片重新挂载。当前使用块序号与来源，连续文本输入不会重建图片；
  同一来源的重复图片仍为独立节点。
- `resizeEditorContent` 保持稳定，用 WeakMap 按 textarea 的 value、编辑区宽度及
  末段身份缓存，只调整变化段。窗口、字体加载及隐藏编辑区恢复可见仍须重新测量；
  临时缩小高度前后保留滚动位置。读高度与写高度分批执行。
- 图片横线间距根据原占位值求差，批量读后批量写。图片尺寸通过 ResizeObserver
  与加载事件更新；不能在每次输入时逐图清零间距再测量。
- CSS 隐藏不能阻止 React Markdown 工作。App 按当前断点和视图挂载预览；
  Playwright 导出和桌面分享必须显式保留预览，编辑器保持挂载以保留上传队列。
- `npm run benchmark:input -- --images 100 --characters 30 --warmup 5 --interval 10
  --assert-incremental-layout --json` 使用隔离浏览器、合成图片和匿名 API 响应。
  采样使用 rAF 回调内的 performance.now()，不能用可能早于 keydown 的帧时间戳。
  本机 Chromium 145 开发构建：桌面 p95 从 187.1ms 降到 13.1ms；30 次输入的
  文本高度读取从 24,240 降到 60、图片尺寸读取从 12,009 降到 0，图片节点重建为 0。
  绝对延迟受环境影响，回归优先检查节点复用与布局工作量。
- 开发工作区完整 feedback 364 项通过（前端 224、后端 123、DSH 17）。
  从线上 1.15.0 隔离出的 1.15.1 发布副本完成干净依赖安装、296 项 feedback
  （前端 211、后端 68、DSH 17）及完整构建；
  `verify-editor-image-uploads.mjs` 验证 102 图和最多 5 并发；
  `verify-editor-input-layout.mjs` 验证重复图片、文字高度增长与收缩、中间及末尾
  中文输入、滚动保持、标注、本地保存、响应式预览、分享与 Playwright 导出预览。
  手机仅用浏览器视口验证，未启动 iOS 模拟器。
