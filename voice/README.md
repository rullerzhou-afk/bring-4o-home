# Memoria Voice Service

Python 语音服务，为 Memoria.chat 提供语音交互能力。

## 前置依赖

### Windows / macOS

无需额外操作，`sounddevice` 自带 PortAudio 二进制。

### Linux (Debian/Ubuntu)

```bash
sudo apt install libportaudio2
```

### Linux (Fedora/RHEL)

```bash
sudo dnf install portaudio
```

## 快速开始

```bash
cd voice
pip install -r requirements.txt
```

### 硬件测试

```bash
python main.py --test-audio
```

预期流程：
1. 打印可用音频设备列表
2. 开始录音（5 秒）
3. 录完自动播放
4. 从音箱听到自己的声音即为成功

### Talk 模式（语音转文字 + 对话持久化）

**前置条件**：Node.js 服务运行中（`npm start`），`OPENAI_API_KEY` 已配置。

```bash
python main.py --talk
```

预期流程：
1. 首次运行自动下载 Silero VAD 模型（~2.2MB）
2. 打印 `[Session] 新对话: xxxxx` + `[IDLE] Press Space to talk...`
3. 按 Space → 听到"叮" → 终端显示 `[LISTENING] 正在听...`
4. 对着麦克风说几句话
5. 停顿约 1.5 秒 → 自动结束录音 → `[PROCESSING] 识别中...`
6. 打印 `You: <识别出的文字>`，消息同步到 Web 端
7. 回到 `[IDLE]`，等待下次按键
8. 空闲 2 分钟 → 播放提醒音 → 15 秒无响应 → 播放再见音 → `[SLEEPING]`
9. SLEEPING 状态按 Space → 唤醒回到 IDLE
10. Ctrl+C 退出

## 配置

编辑 `config.yaml` 或通过环境变量覆盖：

| 环境变量 | 配置键 | 默认值 | 说明 |
|---|---|---|---|
| `SAMPLE_RATE` | `sample_rate` | `16000` | 采样率 |
| `CHANNELS` | `channels` | `1` | 声道数 |
| `MEMORIA_URL` | `memoria_url` | `http://127.0.0.1:3000` | 服务地址 |
| `ADMIN_TOKEN` | `admin_token` | (空) | 鉴权 token |
| `VAD_THRESHOLD` | `vad_threshold` | `0.5` | 语音检测阈值 0~1 |
| `SILENCE_DURATION` | `silence_duration` | `1.5` | 静音多久算说完（秒） |
| `MAX_RECORDING` | `max_recording` | `60` | 录音上限（秒） |
| `LANGUAGE` | `language` | `zh` | STT 语言（ISO 639-1） |
| `SESSION_TIMEOUT` | `session_timeout` | `30` | 对话超时（分钟），超时新建 |
| `IDLE_REMIND_M` | `idle_remind_m` | `2` | 空闲提醒（分钟），0=禁用 |
| `IDLE_REMIND_WAIT_S` | `idle_remind_wait_s` | `15` | 提醒后等待（秒） |

> **Security**: Use environment variables for `ADMIN_TOKEN`. Never put real tokens in `config.yaml` (it's tracked by git).

## 项目结构

```
voice/
├── main.py              # 入口（--test-audio / --talk）
├── config.py            # 配置加载
├── config.yaml          # 默认配置
├── state_machine.py     # 状态机定义
├── audio_io.py          # 麦克风录音 + 播放 + VAD 录音 + WAV 编码
├── vad.py               # Silero VAD V5 ONNX 封装
├── memoria_client.py    # Memoria API 异步客户端
├── session.py           # 会话生命周期管理
├── models/              # VAD 模型（自动下载，不入 git）
├── requirements.txt     # Python 依赖
└── README.md
```
