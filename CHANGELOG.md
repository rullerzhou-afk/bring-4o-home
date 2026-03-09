# Changelog

## 2026-03-09

### New Features
- **全量模型选择器** — 顶栏模型选择器重做：搜索框 + 最近使用标签栏 + 按 Provider 分组的完整模型列表（彩色圆点 + Provider · 模型名），去掉硬编码白名单，开放所有聊天模型
- **语音页自动记忆** — 语音对话中自动学习用户偏好/身份信息，紫色气泡通知已学到的内容（8 秒后淡出）
- **本地 Whisper STT** — 语音设置中"本地 Whisper"选项现已可用，支持 `STT_BASE_URL` 对接本地 Whisper 服务器，或自动调用 Python 脚本（faster-whisper / openai-whisper 双后端）
- **URL hash 路由** — `/#settings` 直接打开设置面板，`/#convId` 跳转指定对话

### Bug Fixes
- **语音页英文对话回中文** — 语音系统消息现根据界面语言动态切换中英文，不再硬编码中文
- **英文对话记忆存成中文** — auto-learn 增加语言检测，英文对话强制要求 LLM 用英文记录
- **本地 Whisper 中文乱码** — Windows 下 Python 子进程输出强制 UTF-8 编码，修复 GBK/cp936 乱码

### Improvements
- **模型列表并行加载** — 三个 Provider 并行请求 + 8 秒超时 + 启动预热缓存，首次点击秒开
- **火山引擎 fallback** — models.list 不可用时自动填入常见豆包模型名
- **语音自动学习节奏优化** — 从固定冷却期改为 15 秒防抖，适配语音对话的快速节奏
- **beforeunload 监听器清理** — 语音页 destroy 时正确移除事件监听，防止泄漏
- **异步文件写入** — 本地 STT 临时文件改用 async I/O，不阻塞事件循环

## 2026-03-08

### New Features — Voice Web Page (`/voice`)
- **独立语音对话页面** — 浏览器直接语音对话，中央动态球体可视化音量脉动，实时显示用户语音和 AI 回复文字
- **双模 STT** — Web Speech API（浏览器原生）+ MediaRecorder 录音上传 Whisper（API 模式），自动降级
- **Edge TTS 后端** — 默认使用免费 Edge TTS，失败自动降级到 OpenAI TTS
- **语音设置面板** — 聊天页设置新增语音 Tab，可选 STT/TTS 提供商、音色、语速
- **SSE 流式分句播放** — AI 回复边生成边朗读，句子缓冲器智能分句（中英标点 + 强制截断）
- **打断机制** — AI 说话时点击麦克风立即打断，保存部分回复，重新开始录音
- **提取共享 SSE 解析器** — `sse-reader.js` 从 chat.js 抽取，voice 和 chat 复用

### New Features — Voice Plan Step 7.6: Continuous conversation & farewell detection
- **连续对话模式** — AI 说完后自动等待用户继续说话（默认 6 秒），不需要重新喊唤醒词。超时无响应才退回唤醒等待状态
- **告别检测** — 在连续对话中说"再见"、"拜拜"、"没事了"、"bye" 等，AI 回复后自动进入休眠（限短句 ≤15 字，避免误触发）
- **配置项** — `continue_timeout`（秒），设 0 可关闭连续对话功能

### Improvements
- **VAD 启动超时** — `stream_record_with_vad` 新增 `start_timeout` 参数，连续对话等待期间若无人说话直接返回，避免录空音频

## 2026-03-07

### New Features — Voice Plan Step 7.5: Sound effects & wake response
- **音效系统** — `voice/sound/` 目录放音频文件，启动自动加载（支持 MP3/WAV/OGG/FLAC，自动重采样到 24kHz）
- **四种音效** — 开机音（turn_on）、关机音（shut_down）、接收音（take_over，与 STT 并行播放）、报错音（error）
- **唤醒回应** — 说唤醒词后自动播放 TTS 生成的 "I'm here"（首次启动自动生成并缓存到 sound/wake_response.wav）
- **服务器检查** — 启动时如果连不上 Node 服务，播报错音并退出（exit code 1），systemd 会自动重启
- **STT 计时** — 终端显示 STT 耗时和录音时长比率，方便性能调优

### New Features — Voice Plan Step 7: Configuration & deployment
- **自定义说话键** — `talk_key` 配置项，不再硬编码 Space，支持 keyboard 库所有键名
- **确认音开关** — `filler_enabled` 配置项控制录音后的"叮"提示音
- **隐私模式** — `log_transcripts` 配置项控制是否在终端打印用户语音文本，默认关闭只显示"已识别"
- **自定义配置路径** — `--config PATH` 命令行参数，支持指定任意 config.yaml 位置
- **systemd 部署** — 提供 `memoria-voice.service` 模板，Linux 服务器一键部署

### Improvements
- **参数瘦身** — 录音/STT 配置打包为 `ListenCfg` dataclass，`_do_speak` 从 17 个参数降到 10 个
- **布尔环境变量校验** — 无效值（如 `FILLER_ENABLED=on`）不再静默变 False，改为警告并保留默认值

## 2026-03-06

### Bug Fixes — Voice TTS playback stability
- **修复首句突突突卡顿** — prebuffer 从 200ms 提升至 500ms，arm 条件收紧为 AND（≥2 chunks 且 ≥500ms），彻底解决网络抖动导致的句间队列饥饿
- **修复首句变调/拉长** — 静音 keepalive 从 1e-10 改为 AC dither ±1e-4，防止 WASAPI/DAC 端点挂起后恢复变调
- **提示音时机调整** — ding 从录音前移到录音后（STT 前），消除提示音干扰 TTS 播放的问题
- **缩短录音后等待** — VAD silence_duration 从 1.5s 降至 0.8s，说完话后更快结束录音
- **打断后保留 AI 部分回复** — barge-in 时 pipeline 返回已积累的文本并保存到对话，终端显示 `AI (interrupted): ...`，前端也能看到
- **修复报错后音频不停** — pipeline 异常退出时立即 interrupt 播放器，不再把已缓冲的音频播完

### New Features — Voice Plan Step 6: Barge-in (interrupt AI while speaking)
- **按键打断 AI** — AI 说话时按 Space 立即停止音频播放，开始录音接收新指令，无需等 AI 说完
- **连续打断** — 支持反复 barge-in：打断→说话→AI 回复→再打断，循环不断
- **即时中断** — 三层取消机制（cancel event + task.cancel + player.interrupt）确保音频、HTTP 请求、TTS 合成同时停止，无延迟
- **Pipeline 隔离** — 每次 AI 回复使用独立 cancel event，避免旧/新 pipeline 互相干扰

### New Features — Voice Plan Step 5: Wake word detection
- **语音唤醒** — 支持语音唤醒词触发对话，无需按键。基于 sherpa-onnx zipformer 中英双语 KWS 模型（~4MB），支持任意中文/英文关键词，无需训练
- **三种触发模式** — `trigger_mode` 配置：`keypress`（Space 按键）、`wakeword`（语音唤醒）、`both`（两者并行）
- **自定义唤醒词** — 通过 `wake_word` 配置，支持逗号分隔多个唤醒词（如 `"小莫小莫,hey memoria"`）
- **自动模型下载** — 首次启用唤醒词模式时自动下载 KWS 模型，后续离线可用
- **麦克风共享** — 唤醒词监听与 VAD 录音自动切换麦克风，通过 pause/resume 机制避免冲突

## 2026-03-05

### New Features — Voice Plan Step 4: SSE streaming → TTS → gapless audio playback
- **AI 语音回复** — 录音识别后 AI 自动回复并朗读，支持 SSE 流式对话 + 实时 TTS 合成 + 无缝音频播放
- **三级流水线** — SSE 流→断句→TTS 合成→播放四步并行，AI 说第一句话时后续句子已在合成，延迟极低
- **无缝播放引擎** — 自研 TTSPlayer 回调驱动音频播放器，解决 Windows WASAPI 首音节吞字、多流冲突、静默后变调等问题
- **统一音频通道** — 提示音和 TTS 语音共用单一音频流，消除 Windows 多流输出冲突
- **断句缓冲器** — SentenceBuffer 按中英文标点切分 AI 回复，避免半句话送 TTS

### New Features — Local STT + AMD GPU acceleration
- **本地语音识别** — 新增 faster-whisper 本地 STT 后端（`stt_provider: "local"`），无需依赖服务端 API，录音直接在本地转文字
- **AMD GPU 加速** — 新增 openai-whisper + PyTorch 后端（`stt_provider: "local-torch"`），通过 ROCm 7.2 支持 AMD 显卡 GPU 加速
- **自动语言检测** — 默认 `language: "auto"`，Whisper 自动识别中英文，无需手动切换
- **STT 架构重构** — 提取 `BaseTranscriber` 基类 + 工厂函数 `make_transcriber()`，统一 faster-whisper / openai-whisper 两套后端的接口

## 2026-03-04

### New Features — Voice Plan Step 3: STT + session management + idle reminder
- **录音转文字** — 按 Space 说话后自动将录音发送至 Whisper STT，终端打印识别文字 `You: ...`
- **对话持久化** — 语音消息自动同步到 Web 端，侧边栏可看到"语音对话 MM/DD"
- **会话超时管理** — 30 分钟无活动自动新建对话（可配 `session_timeout`）
- **空闲休眠提醒** — 2 分钟无操作播放提醒音，15 秒内无响应播放再见音进入 SLEEPING 状态
- **异步架构** — talk_loop 迁移到 asyncio 事件驱动，keyboard→asyncio 桥接，为 Step 4 流水线做准备
- **自动读取 .env** — Python 语音服务自动从项目根目录 `.env` 读取 `ADMIN_TOKEN` 等配置，无需手动传参
- **Memoria API 客户端** — httpx 异步 HTTP 客户端，绕过系统代理（`trust_env=False`），支持创建对话、追加消息、STT 转写

### New Features — Voice Plan Step 2: Talk key + VAD end-of-speech detection
- **按键说话模式** — `python main.py --talk`：按 Space 开始说话，Silero VAD V5 自动检测说完（静音 0.8 秒），打印录音时长和峰值振幅
- **Silero VAD V5 封装** — ONNX 推理，首次运行自动下载模型（~2.2MB），逐帧 512 samples 处理，返回语音概率
- **确认音** — 按下说话键后播放 880Hz 正弦波提示音（48kHz 播放，兼容 Windows 声卡）
- **采样率校验** — VAD 录音入口强制 16kHz，防止配置覆盖导致检测失效

### New Features — Voice Plan Step 1: Python voice service skeleton + audio I/O
- **Python 语音服务骨架** — `voice/` 目录新增 6 文件：config 加载（YAML + 环境变量覆盖）、6 状态状态机（IDLE/LISTENING/PROCESSING/SPEAKING/SLEEPING/ERROR）、麦克风录音 + 音箱播放模块
- **硬件验证工具** — `python main.py --test-audio` 一键录 5 秒回放，打印设备列表和峰值振幅，静音自动告警

## 2026-03-03

### New Features — Voice Plan Step 0: Server-side API for voice service
- **Server-side conversation creation** — `POST /api/conversations` creates conversations server-side with auto-generated ID, enabling Python voice service and other non-browser clients to manage sessions without frontend
- **Message append endpoint** — `PATCH /api/conversations/:id/messages` appends messages to existing conversations with lock protection and 500-message limit enforcement
- **STT proxy route** — `POST /api/voice/stt` proxies audio to OpenAI Whisper API, accepts multipart upload (≤25MB), returns transcribed text. Returns 503 if no OpenAI key configured
- **TTS proxy route** — `POST /api/voice/tts` proxies text to OpenAI TTS API with voice whitelist validation, streams audio/mpeg response. Supports pipe with stream error handling
- **Node 18+ compatibility** — STT uses `openai.toFile()` instead of global `File` (only available in Node 20+)

### New Features — 前端 UI 双语化 (i18n)
- **中英双语切换** — 设置面板新增语言选择器，支持中文/English 一键切换，自动检测浏览器语言作为默认值，刷新后保持选择
- **220+ 翻译键** — 全量覆盖按钮、标题、提示、错误消息、时间格式、记忆分类、导入流程等所有 UI 文本
- **英文人格模板** — "插入模板"按钮在英文模式下返回完整的英文人格模板
- **零依赖实现** — 内联字典 + `t()` 函数 + `data-i18n` 属性批量更新，无需 i18n 框架
- **语言切换响应** — 切换语言后侧边栏分组、消息区、设置面板、主题提示均实时更新

### Bug Fixes — P2 全量审查
- **Map 无限增长防护** — `_convLocks` 和 `cooldownMap` 两个内部 Map 新增容量上限，超限时自动淘汰旧条目，防止长时间运行后内存膨胀
- **模型名称校验统一** — 提取 `isValidModelName()` 到 validators.js，消除跨文件重复正则
- **对话总结模型校验** — 总结和融合端点新增模型名正则+长度校验
- **摘要字段类型校验** — PUT 对话接口的 summary 字段现在严格校验为 `{text, upToIndex, generatedAt}` 结构或字符串（兼容旧格式），防止任意对象写入磁盘；校验逻辑移出锁回调，修复双响应 bug
- **前端共享状态声明** — `memoryStore` 和 `_groupsInitialized` 移入 `state.js` 统一声明
- **设置面板请求去重** — 模型列表和配置请求新增 2 秒短时缓存，避免打开设置时重复请求
- **对话排序精度修复** — 对话列表排序从 `parseInt` 改为字符串长度+字典序比较，避免大数字 ID 精度丢失
- **Auto-learn 校验优化** — 先截取最后 4 条消息再做校验，大请求不再白耗 CPU

## 2026-03-02

### Improvements — 测试覆盖补全
- **路由层测试覆盖** — 新增 8 个路由测试文件，覆盖 auto-learn（验证/过滤/LLM分支/undo/reflect）、conversations（CRUD/搜索/批量删除/孤儿清理）、prompts（读写/版本管理/恢复）、config（读写/重置）、images 和 files 的 magic bytes 校验
- **lib 层测试补充** — `readMemoryStore`/`writeMemoryStore`/`updateMemoryReferences` + `readConfig`/`saveConfig`/`pruneBackups`/`rebuildIndex` 新增单元测试
- **测试基础设施** — 新增 `mock-req-res`、`extract-handler` 共享 helper，路由测试统一使用 `vi.spyOn` 模式（兼容 vitest 4 CJS）
- **测试总数**: 476 → 670（+194）

### Bug Fixes — P1 全量审查
- **Windows 原子写入修复** — `atomicWrite()` 在 Windows 下先尝试 rename，EPERM 时才 unlink+retry，避免不必要的文件删除窗口
- **对话总结 ID 类型校验** — `conversationIds` 数组元素现在严格校验为字符串格式，防止数字被隐式转换通过
- **融合 Prompt 输入校验** — `newSystemFindings`/`newMemoryFindings` 新增字符串类型检查和 50000 字上限，防止超大 payload 烧 token
- **剪贴板复制异常处理** — HTTP 环境或权限拒绝时不再触发全局错误提示
- **Toast 颜色语义修正** — 新增成功（绿）和信息（蓝）两种 toast 类型，成功/信息消息不再显示为错误红色
- **escapeHtml 统一** — 前端三份重复的 HTML 转义函数合并为 `api.js` 单一导出，消除 files.js 缺单引号转义的不一致
- **记忆列表 data-id 转义** — `renderMemoryList` 中的 `data-id` 属性现在经过 HTML 转义，防御潜在 XSS
- **401 认证取消提示** — 用户取消输入 ADMIN_TOKEN 后现在会显示 warning toast 而非静默失败

### New Features — 记忆反思/整合（Phase 3A）
- **手动整合记忆** — 设置面板 → 长期记忆工具栏新增「整合记忆」按钮，一键分析近期动态，从零散事件中提炼高层模式和洞察（如"持续关注 AI 领域"），写入偏好习惯或核心身份
- **洞察自动高评级** — 整合产出的洞察自动标记为核心重要性（★★★），获得最高注入优先级
- **安全保护** — 不会覆盖源事件（排除 events 类别防去重误删）、记忆满时明确提示、近期动态不足 3 条时提示暂无法整合
- **Loading 状态** — 按钮点击后进入 loading 态（SVG 旋转 + 不可重复点击），完成后 toast 提示结果

### New Features — 对话摘要压缩
- **自动压缩长对话** — 开启后，当消息超过上下文条数时，自动将旧消息压缩为叙事摘要注入 AI 的 system prompt，让 AI 始终了解整段对话脉络，同时大幅节省 token。默认关闭，设置面板可开启
- **手动压缩按钮** — 对话超过 10 条时顶栏出现 📦 按钮，一键生成/更新摘要
- **摘要缓存** — 生成的摘要缓存在对话文件中，连续聊天不会重复生成（STALE_MARGIN = 5 条容忍度），编辑/重新生成消息时自动清除过期缓存
- **保留最近消息条数可配** — 设置面板可调整压缩时保留多少条原始消息（默认 10，范围 2-100），越多上下文越精确但 token 越多
- **图片消息智能处理** — 压缩时自动过滤纯图片消息，不浪费 token 在 base64 数据上
- **失败不阻断聊天** — 摘要生成失败（超时/API 异常）时 toast 提示并回退到普通模式，聊天不受影响

### New Features — 记忆管理增强（Phase 3B）
- **记忆搜索过滤** — 长期记忆面板新增搜索框，输入关键词实时过滤记忆条目，空分类自动隐藏，清空搜索恢复全部
- **重要性 & 引用次数可视化** — 每条记忆左侧显示重要性星标（★/★★/★★★，灰/琥珀/红三色），引用次数 >0 时显示蓝色徽章（×N）
- **记忆独立导出** — 一键导出为 `memoria-memory-YYYY-MM-DD.json`，包含三分类数组和完整元数据，方便备份和跨实例迁移
- **记忆独立导入** — 支持导入 JSON 文件，可选替换或合并模式（合并按文本去重），导入后需点保存生效
- **Auto-learn 排除 UI 操作** — 自动记忆学习不再把切换主题、调整面板等界面交互误当成用户偏好

### New Features — 记忆系统 Phase 2B（记忆晋升/降级）
- **记忆自动晋升** — 高频引用且存在一定时间的"近期动态"会自动晋升为"偏好习惯"，超高频的核心偏好还能进一步晋升为"核心身份"，让重要记忆获得更高注入优先级
- **记忆自动降级** — 长期未被引用（90天+）且引用次数极低的"偏好习惯"会自动降级回"近期动态"，腾出优先注入空间
- **设置面板开关** — 参数 tab 新增「记忆晋升/降级」开关，默认关闭
- **Toast 通知** — 发生晋升/降级时右下角提示"N 条记忆晋升，M 条记忆降级"

### New Features — 记忆系统 Phase 2A（记忆衰减清理）
- **记忆自动衰减** — 长期未被引用的低重要性记忆会被自动清理或标记为过期，防止记忆池无限膨胀。设置面板可配置是否启用及空闲天数阈值（默认关闭）
- **过期记忆视觉标识** — 设置面板中被标记为过期的记忆条目灰显并标注"(过期)"，一目了然
- **过期记忆自动排除** — 被标记过期的记忆不再注入到 AI 对话中，节省 token 预算；如果记忆被重新引用会自动解除过期标记
- **衰减规则** — 近期动态（events）：重要性=1 超期自动删除，重要性≥2 标记过期；偏好习惯（preferences）：90 天未引用标记过期；核心身份（identity）：永不衰减

## 2026-03-01

### New Features — 记忆系统 Phase 2C（Auto-learn 去重）
- **重复记忆自动合并** — AI 学习新记忆时，如果跟已有记忆高度相似（bigram 重叠 >60%），自动合并而非重复新增，减少记忆膨胀。合并操作在反馈卡片中用紫色 "≈ 合并" 标识，与普通新增/更新/删除区分
- **容量满时合并仍生效** — 记忆库超过 50KB 时，能合并的 ADD 操作仍会以 UPDATE 形式执行（缩减体积），不再被一刀切跳过
- **同批次防重复匹配** — 同一次学习中多条相似记忆不会匹配到同一条旧记忆，避免产生重复更新

### Bug Fixes
- **AI 回复在特定时机丢失** — 打开页面后立即发消息，如果后台数据同步恰好在流式回复期间完成，AI 回复会被写入已废弃的对象导致丢失。修复：流式回复全程使用闭包持有的对话引用保存，不再依赖从列表重新查找
- **重新生成回复时异常被静默吞掉** — `regenerateMessage` 没有等待流式回复完成，错误变成未捕获异常。修复：函数改为 async 并正确 await
- **异步回调可能复活已删除的对话** — 自动生成标题等异步操作完成后，即使用户已删除该对话仍会将其重新写回服务端。修复：保存前检查对话是否仍存在于列表中

### Bug Fixes（安全 & 稳定性）
- **Windows 下极端情况可能丢失数据文件** — 原子写入在 Windows 上多了一步不必要的删除操作，如果删除成功但后续重命名失败，文件就没了。修复：去掉多余步骤，直接覆盖写入
- **自动记忆学习可被恶意请求滥用** — 对话 ID 没有格式校验，随便传个字符串就能绕过冷却期无限触发学习（烧 API 额度）。修复：对话 ID 必须符合标准格式才接受
- **无效请求白白浪费冷却窗口** — 格式错误的请求也会消耗 3 分钟冷却期，导致紧随其后的正常请求被跳过。修复：只有通过全部校验的请求才消耗冷却

### Improvements
- **自动记忆学习冷却期缩短为 3 分钟** — 从 5 分钟降至 3 分钟，对话中的新信息能更快被记住（仍可通过 `AUTO_LEARN_COOLDOWN` 环境变量自定义）
- **对话 ID 校验统一** — 三处重复的对话 ID 格式正则提取为共享函数 `isValidConvId()`，维护时改一处即可

### New Features — 记忆系统 Phase 1C（Auto-learn 反馈闭环）
- **记忆学习可展开卡片** — AI 自动学习记忆后，底部弹出可展开卡片，显示每条操作详情（新增/更新/删除，按颜色区分），3 秒后自动折叠，点击可重新展开
- **一键撤销** — 卡片内提供撤销按钮，可立即撤销刚刚学到的记忆（ADD 和 UPDATE 可撤销，DELETE 不可恢复）
- **操作计数优化** — 纯删除操作显示"移除了 N 条"而非"记住了"，混合操作分别计数

### New Features — 记忆系统 Phase 1B（对话内嵌记忆指示器）
- **记忆引用可视化** — 每条 AI 回复底部显示"记忆 ×N"徽标，点击展开查看本次回复引用了哪些记忆（按分类分组 + 重要性星标），让记忆系统不再是黑盒
- **记忆引用快照** — 引用的记忆以快照形式保存在对话中，即使记忆后续被删改，历史消息仍能看到当时的引用情况
- **显示记忆引用开关** — 设置面板新增复选框，可关闭记忆指示器（纯前端偏好，默认开启）

### Improvements
- **记忆模块内部重构** — 消除三处重复代码：渲染逻辑统一为 `renderCategories()`、排序优化减少重复计算、引用计数更新封装为独立函数

### Bug Fixes（审查债务清理 — 9 项）
- **记忆引用开关不实时更新** — 设置面板切换"显示记忆引用"后，已渲染的消息不变。修复：用 CSS class 切换即时隐藏/显示，无需重新渲染
- **索引更新失败静默吞错** — 对话增删改后索引更新失败完全无日志，排查困难。修复：4 处 catch 补 console.warn
- **16 位对话 ID 排序不准** — 对话 ID 超过 JavaScript 安全整数上限（15 位），`Number()` 转换丢失精度导致排序错乱。修复：改用长度优先 + 字典序比较
- **对话文件并发写入无锁** — 连续快速发消息时多个写操作竞态覆盖。修复：新增 per-conversation 互斥锁
- **图片 MIME 白名单过宽** — 对话校验接受任意 `data:image/*`，绕过上传端点的格式限制。修复：收紧为 PNG/JPEG/GIF/WebP 四种
- **联网搜索无超时** — Serper API 无响应时请求永久挂起。修复：10 秒 AbortController 超时
- **Token 比较泄漏长度** — `timingSafeEqual` 要求两端等长，短路返回暴露 token 长度。修复：改用 HMAC 比较（固定 32 字节 digest）
- **批量删图片可能爆文件描述符** — 大量图片同时 unlink 触发 EMFILE。修复：分批 20 个处理
- **流式回复超时计时器泄漏** — 流式出错时 catch 块无法访问 try 内声明的 timer 变量（let 块级作用域），`clearTimeout` 不执行。修复：提升变量声明到 try 外部

### Tests（基础设施函数测试 — 5 组）
- `extractJsonFromLLM` — LLM 输出 JSON 解析器（代码块/裸 JSON/嵌套括号/无 JSON 异常），8 个用例
- `atomicWrite` — 原子文件写入（正常读写/无残留临时文件/覆盖），3 个用例
- `createMutex` — Promise 互斥锁（FIFO 顺序/抛错不死锁/返回值传递），3 个用例
- `tryAcquireCooldown` — 冷却期门卫（首次通过/冷却内拒绝/独立 convId/非字符串拒绝），4 个用例
- `readCookieToken` — Cookie 解析（单 cookie/多 cookie/URL 编码/异常编码/缺失），6 个用例

### Bug Fixes
- **validateMessages 丢弃 meta 和 reasoning** — 对话保存时校验逻辑只保留 `{role, content}`，导致 token 用量、模型名、时间戳和思考链数据被静默丢弃。修复：校验时保留 `meta`（对象类型）和 `reasoning`（字符串类型）
- **无 token 数据时显示"0 tokens"** — 不返回 usage 的模型提供商（如部分火山引擎模型），meta 事件仍发送 0 值 token 计数。修复：仅在有实际用量数据时才包含 token 字段

## 2026-02-28

### New Features — 记忆系统 Phase 1A（智能注入排序）
- **记忆按重要性排序注入** — 不再按时间由新到旧排序，改为综合分（`importance × 时间衰减`）排序，核心身份记忆（如你的名字、职业）即使很久没提起也不会被挤出上下文
- **记忆引用计数** — 每次对话成功后，被注入的记忆自动 +1 引用次数并更新最后引用时间，为后续衰减/晋升规则提供数据基础

### New Features — 记忆系统 Phase 0（Schema 升级 + 重要性评分）
- **记忆条目三新字段** — 每条记忆新增 `importance`（1-3 重要性）、`useCount`（引用次数）、`lastReferencedAt`（最后引用时间），为后续衰减/晋升规则打地基：
  - `importance` 三档评分：1=临时信息、2=一般事实、3=核心身份，Auto-Learn 提取时由 LLM 自动评分
  - 旧数据零迁移成本：缺失字段通过 `validateMemoryStore` 自动补默认值（importance:2, useCount:0, lastReferencedAt:null）
  - 所有记忆创建入口（auto-learn/前端手动添加/迁移/校验器）均包含三个新字段
- **Auto-Learn 重要性评分** — LLM 提取记忆时可标注 `[importance:1-3]`（可选），核心身份信息自动标为高重要性，临时计划标为低重要性
- **记忆 ID 视图含重要性星标** — `renderMemoryWithIds` 输出 ★/★★/★★★ 标记，LLM 做冲突检测时可直观看到每条记忆的重要程度
- **Memory 配置块** — `config.json` 新增 `memory` 嵌套配置（`decayIdleDays`/`autoDecay`/`promotionUseCount`/`promotionMinDays`），为 Phase 1 衰减/晋升规则预埋
- **UPDATE 元数据继承** — 记忆条目被 UPDATE 替换时，新条目继承旧条目的 `useCount` 和 `lastReferencedAt`，不再重置为零

### Bug Fixes
- **merge-prompt 融合链路元数据丢失** — Import 融合或设置面板编辑记忆时，纯文本写入路径调用 `migrateMemoryMd()` 盲目重建，导致所有条目的 id/importance/useCount/lastReferencedAt 被重置为默认值。修复：新增 `mergeTextIntoMemoryStore()` 函数，用 bigram 相似度匹配已有条目继承元数据，未匹配的才用默认值。从 `migrateMemoryMd` 提取 `parseMemoryText()` 消除重复代码。（来源：Phase 0 已知债务）
- **UPDATE importance 继承失效** — `parseAutoLearnOutput` 在 UPDATE 不带 `[importance:x]` 标签时硬编码返回 `importance:2`，导致 `applyMemoryOperations` 的 `??` 继承链永远走不到旧值。修复：UPDATE 不带标签时返回 `undefined`，让 `??` 链正确继承旧条目的 importance（来源：Codex Review）
- **旧记忆 store 归一化后超限误拒** — `validateMemoryStore` 在归一化后检查 50KB 限制，新增的三个字段每条多 ~50 bytes，接近上限的旧 store 首次读取时可能超限触发重迁移丢数据。修复：改为检查原始输入大小（来源：Codex Review）

### Backward Compatibility
- 旧版 `memory.json`（无新字段）读取时通过 `validateMemoryStore` 自动补默认值，无需手动迁移
- 前端不传新字段时自动填默认值，零破坏
- `config.json` 无 `memory` 块时 `normalizeConfig` 不输出该块，保持向后兼容

## 2026-02-27

### New Features
- **文件阅读** — 支持上传 PDF / Word / TXT / Markdown / CSV / JSON 文档，AI 直接阅读讨论：
  - **服务端解析**：pdf-parse v2 + mammoth 提取纯文本，内存中处理不落盘，三重校验（扩展名 + MIME + magic bytes）
  - **前端交互**：点击📎按钮、拖拽或粘贴上传，输入框上方显示文档预览条（文件名、页数、字数、截断标签），支持一键移除
  - **智能截断**：超长文档截断到 28000 字（预留 2000 给用户消息），黄色"已截断"提示
  - **outbound 分离**：本地消息只存 `📎 filename` 标记（节省 localStorage），发送 API 时注入全文，auto-learn 从 AI 回复中正常提取记忆
  - **图片+文档混合**：拖入多个文件时自动分流，图片走图片通道，文档走文件通道，互不干扰
  - **安全加固**：30 秒解析超时防 PDF bomb DoS、上传请求 AbortController 防竞态、动态字符预算（图片+文档 10k / 纯文档 30k）适配 validator 限制、PDF 解析器 try/finally 保证资源释放

### UI/UX Improvements
- **侧边栏底部工具栏化** — 管理/主题切换/设置三个全宽堆叠按钮改为紧凑布局：
  - 管理和设置合并为一行工具栏（管理降级为小号灰色文本，设置提权为 accent 蓝色 + 齿轮图标）
  - 主题切换移至页面右上角圆形按钮（SVG 太阳/月亮/显示器图标），hover 翻牌动画（Y 轴 180°）
  - 工具栏与对话列表之间新增分隔线
- **上传按钮图标** — 从风景照图标改为回形针📎，语义更清晰
- **文档卡片样式** — 聊天消息中的文档从纯文本 `📎 filename` 改为独立卡片（文件图标 + 文件名 + 类型标签），置于气泡上方，参考 GPT/Claude 风格
- **人格版本管理优化**：
  - 保存版本改为手动触发（新增"保存版本"按钮），取消保存时自动备份
  - 版本历史支持删除单个版本（× 按钮 + 确认弹窗）
  - 新增 `POST /api/prompts/backup` 手动备份端点、`DELETE /api/prompts/versions/:ts` 删除端点
- **默认人格指令改为空白** — 新用户首次打开看到灰字引导（建议结构 + 底层基调），可点击"插入模板"填入完整预设
- **输出格式规则硬编码** — 善用格式、引用块区隔、结构化要点三条规则始终注入 system prompt，用户不可覆盖

### Bug Fixes
- **Import 融合记忆不同步修复** — 导入对话后的总结→融合流程原先读写 `memory.md`，但运行时使用 `memory.json`，导致融合的记忆被静默丢弃：
  - `routes/summarize.js` 的总结和融合端点改为从 `memory.json` 读取真实记忆
  - `routes/prompts.js` 的纯文本 memory 写入路径（旧客户端兼容 + 版本恢复）同步解析到 `memory.json`
  - `lib/prompts.js` 的 `migrateMemoryMd()` 新增对新格式标题（核心身份/偏好习惯/近期动态）和日期后缀格式的解析支持
- **models.js 错误信息泄露修复** — `GET /api/models` 的 catch 块原先将 `err.message` 直接返回客户端（可能包含 API key 片段或内部 URL），改为服务端 `console.error` 记录 + 返回通用 `"Internal server error"`

### Stability Fixes (Phase 0 前置债务清理)
- **Token 认证锁修复** — 用户取消认证弹框后不再卡死，无需刷新页面即可重新输入 (`public/modules/api.js`)
- **ResizeObserver 泄漏修复** — 短回复和切换对话时 spacer observer 保底断开，长会话不再遗留大量活跃 observer (`public/modules/chat.js`)
- **Auto-Learn 冷却 Map 清理** — 冷却记录超过 500 条时自动清理过期条目，服务长跑不再内存泄漏 (`lib/auto-learn.js`)
- **rebuildIndex 并发控制** — 对话文件读取从全量并发改为每批 20 个，大量对话时不再爆文件描述符 EMFILE (`lib/config.js`)
- **orphan-image 清理并发控制** — 对话文件读取和孤儿图片删除均改为分批 20 个并发，与 rebuildIndex 一致 (`routes/conversations.js`)

## 2026-02-25

### New Features
- **人格版本管理（前端）** — 人格指令 Tab 新增完整版本管理功能：
  - **版本历史面板**：可折叠的版本列表，显示相对时间和内容预览，懒加载（首次展开时才请求）
  - **版本对比**：点击"对比"弹出全屏 overlay，左右并排显示当前版本与历史版本内容
  - **一键恢复**：确认后恢复到指定历史版本，恢复前自动备份当前状态，同步刷新人格指令和记忆
  - **插入模板**：人格指令默认空白，工具栏提供"插入模板"按钮，点击可插入出厂模板（有内容时需确认）
- **出厂模板端点** — 新增 `GET /api/prompts/template`，返回默认人格指令模板内容

### New Features (continued)
- **LaTeX 数学公式渲染** — 接入 KaTeX，AI 回复中的数学公式自动渲染为专业排版：
  - **四种分隔符**：行内 `$...$` / `\(...\)`，独立块 `$$...$$` / `\[...\]`
  - **代码块保护**：围栏代码块（`` ``` ``/`~~~`）和行内代码中的 `$` 不会被误渲染
  - **安全设计**：KaTeX HTML 在 DOMPurify 之后注入（绕过 sanitize），错误回退使用完整 HTML 转义防止 XSS；CDN 资源添加 SRI 完整性校验
  - **优雅降级**：KaTeX CDN 加载失败时回退显示原始公式文本，DOMPurify 不可用时降级为纯文本渲染
  - **流式兼容**：流式阶段思考链使用纯文本渲染，最终结果才做 KaTeX 渲染，避免性能浪费

### Bug Fixes & Improvements
- **版本去重显示** — 版本历史列表自动跳过连续相同内容的版本，避免无实际变更时出现大量重复条目
- **智能备份** — 保存人格指令时先比对内容，仅在实际变更时才创建版本快照，减少冗余备份
- **恢复默认清空人格指令** — "恢复默认"按钮改为清空人格指令（而非填入模板），用户可自行选择是否插入模板
- **CSS 作用域隔离** — 工具栏按钮样式使用 `.system-toolbar .toolbar-btn` 限定作用域，避免与消息工具栏样式冲突
- **触屏设备可访问性** — 版本操作按钮始终可见（不依赖 hover），触屏设备可正常使用
- **版本历史滚动隔离** — 版本列表添加 `contain: paint` + `overscroll-behavior: contain`，滚动不再穿透设置面板
- **恢复后记忆同步** — 恢复历史版本后同步刷新记忆列表 UI，避免人格与记忆状态不一致
- **Diff 请求防竞态** — 快速点击不同版本的"对比"按钮时，通过序列号机制丢弃过期响应，确保显示正确版本

## 2026-02-24

### Security & Critical Fixes (P0 Bug Fixes)
- **对话索引并发写入 race condition 修复** — `readIndex` 和 `writeIndex` 本身用互斥锁保护，新增 `_readIndexUnsafe` / `_writeIndexUnsafe` 内部函数供锁内调用，`updateIndexEntry` / `removeIndexEntry` / `rebuildIndex` 改用内部函数避免死锁。批量删除 + 同时保存对话时索引不再损坏
- **图片删除失败导致隐私泄露修复** — `cleanupImages()` 从静默吞错改为 `Promise.allSettled` 记录失败文件名；图片文件名从 `crypto.randomBytes(8)` (64位熵) 改用 `crypto.randomUUID()` (128位熵) 防暴力枚举；新增 `POST /api/conversations/cleanup-orphan-images` 孤儿文件清理端点
- **对话 ID 碰撞风险修复** — ID 生成从 `Date.now().toString()` 改为 `${Date.now()}${3位随机数}`，1ms 内双击创建对话不再产生重复 ID；同时修复 `getConvYearMonth()` 只提取前 13 位作为时间戳，避免分组逻辑解析到错误的未来日期
- **Windows 原子写入失败修复** — `atomicWrite()` 在 Windows 平台 (process.platform === "win32") 下 `rename` 前先 `unlink` 目标文件（忽略 ENOENT 错误），兼容 Windows 不支持 rename 覆盖已存在文件的限制

### Stability & Performance Fixes (P1 Bug Fixes)
- **Auto-learn 按对话冷却** — 冷却时间从全局改为按对话 ID 独立控制（Map<convId, lastTime>），不同对话的 auto-learn 不再互相阻塞；前端 `triggerAutoLearn` 传入 convId，后端路由提取并校验
- **Auto-learn UPDATE 容量检查优化** — 超限场景下，UPDATE 操作直接允许（因为已删除旧条目，替换成更短内容会缩减容量），避免误拦截"替换成更小内容"的合理操作；ADD 操作保持相对大小检查，防止进一步膨胀
- **SSE 流 reader 取消** — 流式数据解析失败时补 `await reader.cancel()` 中止上游流，防止内存泄漏和后台持续占用连接
- **图片 Magic Bytes 严格校验** — PNG 从 8 字节 full signature 检查，JPEG 验证 APP 标记（E0/E1/E2），GIF 检查版本字符串（87a/89a），WebP 验证 RIFF 容器头，伪造文件头的非图片文件不再通过
- **localStorage 对话缓存版本管理** — 前端缓存从裸数组改为 `{version:1, data:[]}` 结构化格式，`CACHE_VERSION` 不匹配时自动清空缓存重新从服务端拉取；旧格式首次加载时自动迁移到新格式，无缝升级

### New Features
- **记忆系统结构化存储（P1）** — 长期记忆从纯文本 `memory.md` 升级为 JSON 结构化存储 `memory.json`，三层分类：
  - `identity`（核心身份）：姓名、职业、年龄等不常变的事实
  - `preferences`（偏好习惯）：沟通风格、兴趣爱好、工具偏好等
  - `events`（近期动态）：正在做的事、近期计划等有时效性的状态
  - 每条记忆含唯一 ID、文本（≤80字）、日期、来源标记（用户手动 / AI 推断）
- **Auto-Learn 分类提取** — 自动记忆提取升级，模型输出带分类标签（`- [identity|preferences|events] 内容`），新记忆自动归入对应分类
- **记忆管理 UI** — 设置面板「长期记忆」从纯文本编辑器改为结构化列表界面，按分类展示所有记忆条目，支持手动添加和单条删除
- **旧数据自动迁移** — 首次访问时自动将现有 `memory.md` 解析迁移到 `memory.json`（`用户画像` → identity，`长期记忆` → preferences），无需手动操作
- **记忆冲突检测与自动解决（P2）** — Auto-Learn 从盲目追加升级为智能冲突处理：
  - 提取时将已有记忆（带唯一 ID）传给 LLM，由模型判断新旧信息是否冲突
  - 支持三种操作：`ADD`（新增）、`UPDATE`（替换旧条目）、`DELETE`（删除过时条目）
  - 状态变化（"在找工作"→"入职了 Google"）自动替换而非并存
  - 向后兼容旧格式输出，安全上限每次最多 10 条操作，50KB 超限时仍允许 DELETE/UPDATE 自愈
- **记忆智能注入（P3）** — `buildSystemPrompt` 从全量塞入记忆改为按优先级选择：
  - 核心身份（identity）始终全量注入，偏好习惯和近期动态按日期新→旧排列
  - 1500 token 预算兜底，超出时从 events 尾部开始裁剪，再裁 preferences，identity 永不截断
  - 轻量 token 估算（CJK×2 + ASCII×0.3），零依赖不引入 tiktoken
- **记忆容量告警（P4）** — 记忆存储达到 50KB 上限时，前端弹出 warning toast 提示用户去设置中清理旧记忆，不再静默跳过

### Bug Fixes
- **Auto-Learn 路由变量重名** — `routes/auto-learn.js` 中 `let response` 与 `const response` 在同一作用域导致 SyntaxError，服务启动即崩溃；重命名为 `payload` 修复
- **容量告警链路失效** — 记忆超 50KB 且全为 ADD 操作时，`applyMemoryOperations` 返回 `undefined` 导致 `capacityWarning` 永远不触发；修复为正确返回 `{ overLimit: true }`

### Backward Compatibility
- `writeMemoryStore` 写入 JSON 时同步渲染 markdown 到 `memory.md`，供 `summarize.js` 等仍读纯文本的模块使用
- `PUT /api/prompts` 同时支持新格式（`memoryStore` JSON）和旧格式（`memory` 纯文本），旧客户端无需改动
- 版本备份同时保存 `memoryStore`（JSON）和 `memory`（渲染文本），新旧版本均可正确恢复
- `validatePromptPatch` 新增 `memoryStore` 字段校验，`validateMemoryStore` 检查完整结构（id/text/date/source/容量）

## 2026-02-23

### New Features
- **对话标题 AI 自动生成** — 首次 AI 回复后自动调用轻量模型生成简洁标题，替代原来截断前 30 字的粗暴方案；写回前重新读取最新文件，避免覆盖期间新增的消息
- **人格版本管理（后端）** — 修改人格设定时自动存版本快照到 `prompts/backups/`；新增 API：列出所有版本、查看某版本详情、恢复到指定版本（恢复前自动备份当前状态）
- **人格与记忆优先级规则** — `buildSystemPrompt` 在同时存在人格和记忆时自动注入优先级段：用户当前指令 > 人格设定 > 记忆
- **Auto-Learn 提取长度对齐** — Prompt 中 "不超过 30 字" 对齐为 "不超过 80 字"，与代码 `MAX_MEMORY_FACT_LENGTH` 一致

### Bug Fixes & Hardening
- **Top P 滑块** — 设置面板「参数」Tab 新增 Top P 滑动条（0–1，步长 0.05），后端已有支持但前端此前无入口
- **优雅关闭** — 新增 SIGTERM/SIGINT 处理，5 秒超时后强制退出；补 `uncaughtException` / `unhandledRejection` 全局异常日志
- **图片上传竞态** — 快速多次拖入图片时 `_addingImages` 锁防止超限
- **图片压缩容错** — `createThumbnail` / `compressImage` 补 onerror 回调，canvas 失败时降级为原图
- **灯箱内存泄漏** — 关闭灯箱时清空 `img.src` 释放内存
- **SSE 解析阈值** — 连续失败阈值从 5 降到 3，更早提示用户
- **欢迎语特殊字符** — `randomGreeting` 的 `String.replace` 改用回调函数，用户名含 `$` 等字符时不再被吞
- **损坏对话文件** — 读取失败时补 `console.warn` 记录文件名和错误，不再静默跳过
- **readConfig 错误** — 非 ENOENT 错误不再被吞掉，输出 `console.warn`
- **isPlainObject 严格化** — 改用 `Object.getPrototypeOf` 检查原型，防止 `Object.create(null)` 等边界情况
- **CSS inset 兼容性** — 替换为 `top/right/bottom/left` 四属性写法，兼容旧版浏览器

## 2026-02-22

### New Features
- **消息悬浮工具栏** — 鼠标悬停消息时显示时间戳、复制、编辑（用户消息）或重新生成（AI 消息）按钮，替代原有的复制按钮
- **编辑用户消息** — 点击编辑按钮进入 textarea 编辑模式，提交后截断后续消息并重新生成 AI 回复
- **重新生成 AI 回复** — 点击重新生成按钮删除当前 AI 回复并重新请求，复用 `streamAssistantReply` 共享流式逻辑
- **发送后智能滚动** — 发送消息后用户消息自动滚到视口顶部，AI 回复在下方逐步展开；scroll-spacer 占位符随回复增长动态缩小，回复足够长时自然过渡到跟随底部滚动
- **移动端响应式适配** — 小屏（≤768px）侧边栏变为固定覆盖层 + 半透明遮罩，选择对话后自动收起；设置弹窗全屏显示；使用 `100dvh` 适配 iOS 地址栏

### Code Quality (Batch 7 — Performance, Security & Compatibility)
- **搜索端点性能加固** — 对话全文搜索从串行逐个读取改为 10 路并发分块处理，新增结果上限 50 条和 5 秒超时截止，防止对话量大时搜索卡死或被 DoS
- **模型列表 TTL 缓存** — `GET /models` 结果在内存中缓存 3 分钟，重复请求直接返回，避免慢网或限流时拖慢设置页
- **图片上传安全加固** — multer `fileFilter` 从静默跳过改为主动拒绝（明确错误提示）；上传后校验 PNG/JPEG/GIF/WebP magic bytes 文件头，伪造扩展名的非图片文件不再通过
- **流式缓冲残余修复** — SSE 流结束后 flush TextDecoder 并处理 buffer 中剩余的完整行，极端情况下最后一段文字不再丢失
- **DOMPurify 配置加固** — Markdown 渲染的 HTML 清理从默认配置改为显式白名单（`ALLOWED_TAGS` / `ALLOWED_ATTR`），关闭 `data-*` 属性，缩小 XSS 攻击面
- **Firefox 文件夹拖拽兼容** — `webkitGetAsEntry` 加 `getAsEntry()` 标准 API fallback，Firefox 用户拖入文件夹不再无响应
- **超时错误友好提示** — 对话总结和 Prompt 融合接口的 `AbortError` 从通用 500 改为 504 + "请求超时，请稍后重试"

### Code Quality (Batch 6 — Cleanup & Performance)
- **备份逻辑统一** — 两个路由的重复备份代码提取为 `backupPrompts()` 公共函数，内部使用 `atomicWrite` 和异步 `mkdir`，消除同步 I/O 阻塞
- **模型名过滤** — `validateConfigPatch` 对 model 字段增加字符白名单校验，含换行符等特殊字符的模型名不再通过验证，防止日志注入
- **context_window 整数化** — `normalizeConfig` 对 `context_window` 加 `Math.round()`，`10.5` 这样的浮点值不再被原样保存
- **JSON 提取智能回退** — 总结/融合接口的 LLM 输出解析从贪婪正则改为 `extractJsonFromLLM()` 渐进式回退（code block → 从最后一个 `}` 向前尝试 `JSON.parse`），多 JSON 输出或夹杂文字时不再匹配错误内容
- **索引重建并行化** — `rebuildIndex` 从串行逐个 `await` 改为 `Promise.all` 并行读取，1000 个对话文件时重建速度大幅提升
- **模型列表扫描上限** — 三个 `models.list()` 循环加 `MAX_MODELS_SCAN=500` 上限 break，API 返回超大模型列表时不再无限迭代

### Code Quality (Batch 5 — Security & Robustness)
- **对话保存校验统一** — `validateConversation` 复用 `validateMessages` 统一校验逻辑，过滤多余字段、拒绝未知 content part type、限制 multi-part 数量，保存到磁盘的数据与发送给模型的一样干净
- **聊天超时改为空闲超时** — 固定 120 秒硬超时改为空闲超时，有 chunk 到达就自动续期，长回复持续产出不再被中途掐断
- **流式解析防护** — `chunk.choices` 加可选链保护，第三方 API 返回异常结构时不再抛 TypeError 中断流
- **Token 时序攻击防护** — ADMIN_TOKEN 比较从 `!==` 改为 `crypto.timingSafeEqual`，防止通过响应时间逐字节猜测
- **Auto-Learn 冷却原子化** — 冷却检查和时间戳设置合并为原子操作 `tryAcquireCooldown()`，并发请求不再同时通过冷却检查
- **403 不再泄露客户端 IP** — 非本地访问被拒时错误消息不再包含 `req.ip`，改为只记服务端日志
- **500 错误消息统一** — 所有路由的 `catch` 块不再将 `err.message` 直接返回给客户端，统一为 `"Internal server error"`，原始错误仅记录到服务端日志
- **Cookie 解析防崩溃** — `readCookieToken` 中 `decodeURIComponent` 加 try/catch，畸形 cookie 不再导致 500
- **Auto-Learn 角色标签修正** — system 消息从误标 "AI" 改为 "系统"，避免人格指令被误判为 AI 说的话

### Code Quality (Batch 4 — Critical Fixes)
- **导入图片上传修复** — 前端图片上传字段名与后端不匹配，导致 ChatGPT 导入时图片始终上传失败；修正后导入图片功能恢复正常
- **索引与记忆并发保护** — 新增 `createMutex()` 互斥锁，`_index.json` 和 `memory.md` 的读-改-写操作加锁串行化，防止并发请求导致数据丢失覆盖
- **全局错误处理中间件** — 未匹配的 `/api` 路由返回 JSON 404（而非 HTML）；全局 error handler 区分 JSON 解析失败、multer 错误和兜底 500，不再返回默认 Express 错误页

### Code Quality (Batch 3 — Lower Priority)
- **图片孤儿清理** — 删除对话时自动清理该对话引用的 `data/images/` 图片文件（单删、批量删除均覆盖），不再磁盘泄漏
- **多标签页同步** — 监听 `storage` 事件实现跨标签页对话列表同步，其他标签页删除/新建/重命名对话后当前标签页自动更新，保留已加载的消息内容
- **导入分支选择改进** — ChatGPT 导入时 `current_node` 缺失的回退策略从"时间最新的叶子"改为"消息链最长的叶子"，避免短分支的重新生成覆盖主对话

### Code Quality (Batch 2 — Medium Severity, Design Required)
- **会话列表索引** — `GET /conversations` 不再全量读取并解析每个对话 JSON 文件，改为维护 `_index.json` 轻量索引；CRUD 操作自动联动更新索引；首次请求自动从文件重建索引
- **启动同步并发化** — 本地独有对话上传从串行逐个 `await` 改为 3 并发 worker 队列，对话多时冷启动同步提速约 3 倍
- **Auto-Learn 移除内容审查** — 删除 `MEMORY_BLOCKLIST` 和 `INSTRUCTION_PATTERN` 内容过滤。开源项目不做用户内容管控，仅保留单条长度限制（≤80 字）和 memory 总量限制（≤50KB）防止膨胀

### Code Quality (Batch 1 — Medium Severity)
- **文件写入原子化** — 新增 `atomicWrite` 工具函数（写临时文件 → fsync → rename），对话保存、配置保存、记忆追加、Prompt 写入等 5 处替换，异常中断不再损坏原文件
- **modelSelector 全量覆盖修复** — 顶栏切换模型从「GET 全量 + PUT 全量」改为只 PUT `{ model }`，不再覆盖其他地方正在修改的参数
- **总结接口 JSON 回退正则修正** — 回退匹配从过时的 `suggestedSystem` 键名改为通用 `{...}` 对象提取
- **backups 自动清理** — 新增 `pruneBackups`，备份目录自动保留最近 20 份，超出自动删除
- **localStorage 溢出渐进降级** — `QuotaExceededError` 时逐级尝试 75%→50%→25%→20→10 条缓存，并弹 toast 提示用户

### Security & Robustness
- **`/images` 目录鉴权** — 图片静态目录纳入 `authMiddleware` 保护，配置了 ADMIN_TOKEN 的部署不再允许未认证访问；auth 中间件新增 cookie 读取支持（`<img>` 标签无法发 Bearer header），前端自动同步 token 到 cookie
- **图片上传唯一文件名** — 上传图片改用 `crypto.randomBytes` 生成随机文件名，不同对话上传同名文件不再互相覆盖
- **后台 API 调用超时保护** — auto-learn、对话总结、Prompt 融合三个端点的模型 API 调用统一加 60 秒超时（AbortController），防止请求卡死无限期挂起

### Performance
- **流式收尾二阶段优化** — 流式结束后先移除光标并画一帧纯文本，再异步执行 Markdown 渲染，消除原来同步全量重渲染导致的 200-500ms 卡顿
- **思考链懒渲染** — 折叠状态下跳过 Markdown 解析，用户展开时才渲染，减少收尾阶段一半的 CPU 开销
- **DocumentFragment 单次 DOM 提交** — 用 `bubble.replaceChildren(frag)` 替代 `innerHTML="" + 多次 appendChild`，减少重排次数
- **滚动延迟到下一帧** — 收尾滚动放到 `requestAnimationFrame` 中执行，避免和 DOM 更新冲突导致布局抖动

## 2026-02-21

### New Features
- **个性化设置** — 设置面板「长期记忆」Tab 新增个性化区域：
  - **AI 名称**：自定义后输入框占位符变为「给 xxx 发消息...」，不填则显示「给 4o 发消息...」
  - **你的称呼**：设置后欢迎语变为「鹿鹿，今天想聊点什么？」等个性化问候，不填则使用通用欢迎语
  - 后端 `config.json` 新增 `ai_name` / `user_name` 可选字段，`normalizeConfig` 和 `validateConfigPatch` 同步支持
  - 保存后立即生效（`applyPersonalization()`），无需刷新页面
  - 恢复默认时自动清空个性化字段

### Bug Fixes
- **401 弹窗重复 3 次**：页面加载时 3 个并发 API 请求同时收到 401，各自独立弹出 `window.prompt()`。改用 deferred Promise 锁模式，确保只弹一次输入框，其余请求等待同一个结果
- **错误 Token 无反馈**：输入错误的 ADMIN_TOKEN 后静默失败，用户不知道发生了什么。现在会弹出 toast 提示「验证失败，请刷新重试」并自动清除 localStorage 中的坏 token
- **Docker 403 无提示**：未设置 ADMIN_TOKEN 的 Docker 部署返回 403，前端无任何反馈。新增 toast 提示「请在 .env 中设置 ADMIN_TOKEN 后重启服务」

### Documentation
- **Docker 部署文档增强**：
  - 新增 `notepad .env` / `nano .env` 编辑步骤，降低新手门槛
  - 新增「修改 `.env` 后怎么生效」章节，说明 `docker compose restart` 不会重新读取 `.env`，必须 `down` + `up`
  - 新增 Docker 更新命令 `git pull` + `docker compose up -d --build`
  - 移除误导性的 `docker compose restart` 常用命令
- **ADMIN_TOKEN 文档统一**：
  - `.env.example` 注释明确三种场景（远程访问/Docker/本机）
  - README 环境变量表 ADMIN_TOKEN 从「否」改为「视情况」
  - 新增醒目提示：Docker 部署、手机访问、其他电脑访问均必须设置

## 2026-02-19

### UI Improvements
- **管理按钮配色**：边框和文字改为主题绿色（`--accent`），hover 时填充绿底白字，与设置按钮视觉区分
- **分组标签增强**：字号 11px→12px，新增底部分隔线，增加上间距，提升辨识度
- **对话列表分组折叠**：
  - 当年月份/季度：单级折叠，点击标题收起/展开
  - 往年（2025、2024…）：默认折叠，显示年份+对话数；展开后按月份子分组，月份也可独立折叠
  - 折叠箭头 ▾/▸ 带旋转动画，搜索模式下不显示分组
- **融合按钮提示**：「融合到现有 Prompt」上方新增说明文字，提示该操作会调用 AI 并消耗 token
- **对话列表默认折叠优化**：打开应用时只展开当月对话，其余月份/季度/年份默认折叠，减少视觉干扰
- **恢复默认设置**：设置面板底部新增「恢复默认」按钮，一键重置人格指令、长期记忆和模型参数为出厂值，保留当前模型选择和已导入的对话不受影响。旧设置自动备份到 `prompts/backups/`

### Refactoring — 大文件拆分 (P3)
- **后端 server.js (1447行) → 16 个模块文件**
  - `server.js` 精简为 36 行薄入口（Express 中间件挂载 + 启动）
  - `lib/` 7 个工具模块：clients、config、prompts、validators、auth、search、auto-learn
  - `routes/` 8 个路由模块：chat、conversations、models、config、prompts、images、auto-learn、summarize
- **前端 app.js (2187行) → 10 个 ES Module 文件**
  - `public/app.js` 精简为 204 行薄入口（事件绑定 + 初始化）
  - `public/modules/` 9 个模块：state、api、render、images、conversations、chat、settings、theme、import
  - 共享可变状态通过 `state` 对象封装，避免 ES Module 导出不可变绑定问题
  - `getCurrentConv()` 放入 state.js 打破 conversations ↔ render 循环依赖
  - `index.html` 改用 `<script type="module">` 加载

### New Features
- **导入 ChatGPT 图片支持 (P1)**：拖入完整导出文件夹即可恢复对话中的真实图片
  - 后端新增 `POST /api/images` 图片上传端点（multer, MIME 白名单, 10MB 限制）
  - 图片存储于 `data/images/`，对话 JSON 引用服务端路径，发送模型前自动转 base64
  - `import-worker.js` 全面重构：支持 `multimodal_text` 消息、DALL-E `tool` 角色、`sediment://` / `file-service://` 资源指针
  - 前端支持文件夹拖拽和 `webkitdirectory` 文件夹选择，自动建立 `fileId → File` 映射并批量上传
  - 仅上传 `conversations.json` 时图片显示占位文本，引导用户上传完整文件夹
- **批量删除对话**：侧边栏新增「管理」模式，支持全选/多选批量删除（最多 2000 条）
- **对话列表按时间分组**：侧边栏按倒序排列，自动插入时间分组标题
  - 当前季度内按月显示（如「2月」「1月」）
  - 过去季度按范围（如「1-3月」）
  - 往年仅显示年份（如「2025」「2024」）
  - 跨年自动降级，无需额外处理

### Bug Fixes
- 修复导入的图片对话继续聊天报错「Only user messages can have multi-part content」：允许 assistant 消息携带数组内容，发送模型前自动展平为纯文本
- 修复多模态消息渲染 bug：循环内 `textContent` 被覆盖导致只显示最后一段文本

### Security & Robustness (Code Review)
- 修复图片路径校验可被 `..` 绕过的路径穿越风险
- 修复图片上传仅校验 MIME 不校验扩展名的绕过风险，文件名消毒增强（连续点号、前导点号）
- 修复 assistant 纯图片消息展平后变空串导致模型 API 报错，改为 `[图片]` 占位
- 修复文件夹导入 `entry.file()` 缺少 reject 回调，读取失败时 Promise 永远 pending
- 修复灯箱重复创建：快速连点图片会叠加多个遮罩层
- 修复图片 base64 转换失败后静默吞错，改为降级显示 `[图片不可用]`

### Error Handling & Reliability (P2)
- 新增全局 `showToast` 通知组件：右下角弹出，支持 error/warning 类型，4 秒自动消失
- 新增 `unhandledrejection` 全局捕获，未处理的异步错误自动弹出 toast 提示
- SSE 流式解析错误从静默忽略改为计数器，连续 5 次失败时提示用户
- `apiFetch` 新增 `navigator.onLine` 离线检测，断网时立即提示而非等待超时
- `saveConversationToServer` 新增 `res.ok` 校验，HTTP 错误和网络异常均弹 toast 提示
- `/api/memory/auto-learn` 新增严格输入校验：role 白名单、content 类型检查、单条内容 20000 字符上限

## 2026-02-15

### New Features
- 新增「导入与总结」功能（设置面板第 4 个 Tab）：
  - 一键导入 ChatGPT 导出的 `conversations.json`，Web Worker 后台解析大文件不卡 UI
  - 「本次导入」与「全部本地」两种范围切换，无需导入也可直接总结现有对话
  - 两步式 Prompt 生成：先提取新发现（不改动现有 Prompt）→ 用户审核 → 点击「融合」智能合并
  - 融合结果可编辑预览，应用前自动备份旧版本到 `prompts/backups/`
- 对话采样策略：均匀取样（头/中/尾），内容超限时列出未纳入的对话标题，用户可自行调整选择
- 导入面板内置 ChatGPT 数据导出指引（可折叠），ZIP 文件误传时给出针对性提示
- 侧边栏底部显示项目名称和版本号，链接到 GitHub 仓库
- README 新增完整的导入三步流程说明

### Bug Fixes
- 总结接口 JSON 解析失败时直接报错，防止误清空用户记忆
- 前端限制总结对话数量上限 50 条
- Worker 在 `current_node` 缺失时按时间戳选取最新叶子节点

## 2026-02-14

### Improvements
- 修复 OpenRouter 403 问题：请求头改为可配置（`OPENROUTER_SITE_URL` / `OPENROUTER_APP_NAME`）
- 新增 `OPENAI_BASE_URL`、`ARK_BASE_URL`、`OPENROUTER_BASE_URL` 配置能力
- 修复 Auto-Learn 在 OpenRouter-only 场景下的模型路由问题
- 增强自动记忆可观测性：失败和跳过原因在控制台输出
