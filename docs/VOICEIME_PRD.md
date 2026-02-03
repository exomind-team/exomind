# VoiceIME 产品需求文档

> **项目**: VoiceIME - 本地语音识别与发言人分离引擎
> **版本**: v2.0.0
> **日期**: 2026-02-03
> **路径**: `exomind-model/`

---

## 1. 产品概述

VoiceIME 是一个**本地优先的语音输入输出引擎**，提供 ASR（语音识别）+ TTS（语音合成）+ Speaker Diarization（说话人分离）的完整 HTTP API 服务。

### 1.1 核心价值主张

| 价值点 | 说明 |
|--------|------|
| **完全本地运行** | 无需联网即可进行语音识别和发言人分离 |
| **发言人识别** | 自动区分"谁在说话"，标记发言时间段 |
| **多引擎架构** | 支持 FunASR、Sherpa-ONNX 等开源引擎 |
| **HTTP API** | 标准化接口，任何工具/Agent 均可调用 |
| **热切换引擎** | 运行时动态切换 ASR/TTS/Speaker 引擎 |

---

## 2. 用户故事

### 2.1 主要用户画像

**用户: 星林 (HailayLin)**
- 计算机系学生，构建"认知生命科学"系统
- 偏好: 本地优先、自动化、从原理理解技术
- 痛点: 现有 ASR 工具要么需要联网，要么无法区分发言人

### 2.2 核心用户故事

```
故事 1: 会议记录自动化
作为    会议参与者
我想要  录制会议并自动识别每位发言人的讲话内容
以便    获得带发言人标签的会议纪要和时间戳

故事 2: 本地语音输入
作为    开发者
我想要  通过快捷键触发本地语音识别并自动输入
以便    在不依赖网络的情况下快速输入文字

故事 3: 多说话人转录
作为    播客/访谈整理者
我想要  上传音频后区分不同说话人并导出字幕
以便    生成 SRT/VTT 格式的字幕文件

故事 4: Agent 语音能力
作为    AI Agent 开发者
我想要  通过 HTTP API 调用语音识别能力
以便    让我的 Agent 具备听觉感知能力
```

---

## 3. 技术架构

### 3.1 系统架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        客户端层                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │   CLI    │  │  Web UI  │  │  Agent   │  │   App    │        │
│  │(voice_ime│  │          │  │          │  │          │        │
│  │   .py)   │  │          │  │          │  │          │        │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘        │
└───────┼─────────────┼─────────────┼─────────────┼──────────────┘
        │             │             │             │
        └─────────────┴──────┬──────┴─────────────┘
                             │ HTTP API (Port 1921)
┌────────────────────────────┼──────────────────────────────────┐
│                         FastAPI 服务层                          │
│  ┌──────────┬──────────────┼──────────────┬──────────┐        │
│  │  ASR API │    TTS API   │  Speaker API │ Engine   │        │
│  │          │              │              │ Manager  │        │
│  └────┬─────┘      ┌────────┴──────┐       └────┬─────┘        │
│       │            │               │            │              │
│       ▼            ▼               ▼            ▼              │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │              Engine Manager (统一引擎管理)                │  │
│  │    ┌─────────┐    ┌─────────┐    ┌─────────────────┐   │  │
│  │    │ ASR     │    │   TTS   │    │     Speaker     │   │  │
│  │    │ Factory │    │ Factory │    │     Factory     │   │  │
│  │    └────┬────┘    └────┬────┘    └────────┬────────┘   │  │
│  └─────────┼──────────────┼──────────────────┼────────────┘  │
└────────────┼──────────────┼──────────────────┼───────────────┘
             │              │                  │
             ▼              ▼                  ▼
┌────────────────────────────────────────────────────────────────┐
│                         引擎实现层                               │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   ASR Engines   │  │   TTS Engines   │  │ Speaker Engines │ │
│  ├─────────────────┤  ├─────────────────┤  ├─────────────────┤ │
│  │ • FunASR        │  │ • Sherpa-VITS   │  │ • CAM++         │ │
│  │ • Nano-2512     │  │ • Kokoro        │  │   (声纹提取)     │ │
│  │ • SenseVoice    │  │                 │  │                 │ │
│  │ • MOSS (Cloud)  │  │                 │  │                 │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

### 3.2 核心数据流

#### 语音识别 + 发言人分离流程

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  音频输入    │────▶│   FunASR    │────▶│   文本识别   │
│  (WAV/MP3)  │     │   模型推理   │     │              │
└─────────────┘     └──────┬──────┘     └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │  CAM++ 声纹  │
                    │   提取      │
                    └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐
                    │  说话人聚类  │
                    │  (Diarization)│
                    └──────┬──────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                     ASRResult 输出                      │
│  {                                                      │
│    "text": "识别文本",                                   │
│    "speaker_segments": [                                │
│      {"speaker_id": "S01", "start": 0.0, "end": 3.5},  │
│      {"speaker_id": "S02", "start": 3.5, "end": 8.2}   │
│    ],                                                   │
│    "num_speakers": 2                                    │
│  }                                                      │
└─────────────────────────────────────────────────────────┘
```

---

## 4. 技术方案详解

### 4.1 本地语音识别方案

| 组件 | 技术选型 | 说明 |
|------|----------|------|
| **核心框架** | FunASR 1.3.1 | 阿里巴巴开源 ASR 工具包 |
| **中文模型** | Paraformer-zh | 非自回归模型，4x 实时率 |
| **实时模型** | Fun-ASR-Nano-2512 | <600ms 延迟，31 种语言 |
| **多语言** | SenseVoice | 支持 5 种语言 + 情感检测 |
| **运行环境** | CPU/GPU | 本地推理，无需联网 |

**模型架构**:
```
音频输入 (16kHz, 16bit, 单声道)
    ↓
特征提取 (Fbank / Mel-filterbank)
    ↓
编码器 (Transformer/Conformer)
    ↓
解码器 (Paraformer 非自回归)
    ↓
后处理 (标点恢复、热词增强)
    ↓
文本输出 + 时间戳
```

### 4.2 发言人分离方案

| 组件 | 技术选型 | 说明 |
|------|----------|------|
| **声纹模型** | CAM++ v2.0.2 | 192 维声纹嵌入 |
| **聚类算法** | 谱聚类 | 基于声纹相似度 |
| **输入要求** | 16kHz 单声道 | 自动重采样 |
| **输出格式** | SpeakerSegment | 时间段 + 说话人 ID |

**Diarization 流程**:
```
长音频输入
    ↓
[滑动窗口] 切分为 2-4 秒片段
    ↓
[CAM++] 提取每个片段的 192 维声纹
    ↓
[谱聚类] 将声纹分组为 N 个说话人
    ↓
[时间对齐] 合并相邻的同一说话人
    ↓
输出: [{"speaker": "S01", "start": 0.0, "end": 3.5}, ...]
```

### 4.3 "谁在说话"识别机制

```
┌────────────────────────────────────────────────────────────┐
│                  说话人身份识别流程                         │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  1. 注册阶段 (一次性)                                       │
│     ┌─────────────┐                                        │
│     │ 参考音频    │──▶ CAM++ 提取 ──▶ 192维声纹向量        │
│     │ (10-30秒)   │           ──▶ 保存 .npy + .json       │
│     └─────────────┘                                        │
│                                                            │
│  2. 识别阶段 (运行时)                                       │
│     ┌─────────────┐                                        │
│     │ 待识别音频  │──▶ CAM++ 提取 ──▶ 声纹向量              │
│     │ 片段        │                                        │
│     └──────┬──────┘                                        │
│            │                                               │
│            ▼                                               │
│     [余弦相似度计算]                                        │
│     similarity = (A·B) / (||A|| × ||B||)                  │
│            │                                               │
│            ▼                                               │
│     ┌─────────────┐                                        │
│     │ 相似度 > 0.5 │──▶ 确认为该说话人                      │
│     │ 阈值可调    │──▶ 返回 speaker_id + 置信度            │
│     └─────────────┘                                        │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

## 5. API 接口规范

### 5.1 核心端点

```yaml
# 语音识别 (支持发言人分离)
POST /v1/asr/transcribe
  Parameters:
    - audio: File (WAV/MP3/M4A)
    - model: string (paraformer-zh, nano-2512, sensevoice)
    - enable_diarization: boolean (是否启用发言人分离)
    - num_speakers: int (指定说话人数，可选)
  Response:
    - text: string (识别文本)
    - speaker_segments: array (说话人时间段)
    - num_speakers: int (检测到的说话人数)

# 独立说话人分离
POST /v1/speaker/diarize
  Parameters:
    - audio: File
    - engine: string (cam++)
    - num_speakers: int (可选)
  Response:
    - segments: array [{speaker_id, start_time, end_time}]

# 引擎管理
GET /v1/engine/asr          # 列出 ASR 引擎
GET /v1/engine/speaker      # 列出 Speaker 引擎
POST /v1/engine/switch/{type}  # 热切换引擎
GET /health                 # 健康检查
```

### 5.2 调用示例

```bash
# 1. 语音识别 + 发言人分离
curl -X POST http://localhost:1921/v1/asr/transcribe \
  -F "audio=@meeting.wav" \
  -F "model=paraformer-zh" \
  -F "enable_diarization=true" \
  -F "num_speakers=2"

# 2. 仅说话人分离
curl -X POST http://localhost:1921/v1/speaker/diarize \
  -F "audio=@interview.mp3" \
  -F "engine=cam++" \
  -F "num_speakers=3"

# 3. 查看可用引擎
curl http://localhost:1921/v1/engine/asr
curl http://localhost:1921/vv1/engine/speaker
```

---

## 6. 项目结构

```
exomind-model/
├── asr/                    # ASR 引擎模块
│   ├── base.py             # ASRClient 抽象基类
│   ├── factory.py          # 引擎工厂
│   ├── funasr_client.py    # FunASR 本地实现
│   ├── nano_client.py      # Nano-2512 实时引擎
│   └── selector.py         # 智能引擎选择器
│
├── speaker/                # 说话人识别模块
│   ├── base.py             # SpeakerEmbedding / SpeakerSegment
│   ├── factory.py          # 工厂类
│   └── camplus_client.py   # CAM++ 声纹引擎
│
├── tts/                    # TTS 引擎模块
│   ├── base.py
│   ├── factory.py
│   └── sherpa_client.py    # Sherpa-ONNX VITS/Kokoro
│
├── service/                # FastAPI 服务层
│   ├── main.py             # 服务入口 (port 1921)
│   ├── api/
│   │   ├── asr.py          # ASR 端点
│   │   ├── speaker.py      # Speaker 端点
│   │   ├── tts.py          # TTS 端点
│   │   └── engine.py       # 引擎管理端点
│   └── models/             # Pydantic 模型
│
├── engine/                 # 统一引擎管理器
│   └── __init__.py         # EngineManager
│
├── tests/                  # 测试套件 (47+ 测试)
├── deploy/                 # 部署配置
│   └── exomind-model.service  # systemd 配置
│
├── voice_ime.py            # CLI 主程序 (F2 快捷键)
└── pyproject.toml          # uv 包管理配置
```

---

## 7. 部署与使用

### 7.1 部署方式

| 方式 | 命令 | 场景 |
|------|------|------|
| **开发模式** | `uv run python -m service.main` | 开发调试 |
| **CLI 模式** | `uv run python voice_ime.py` | 个人使用 |
| **系统服务** | `systemctl --user start exomind-model` | 后台常驻 |

### 7.2 系统要求

```yaml
OS: Linux (Ubuntu 24.04+ 已测试)
Python: >= 3.9
内存: 4GB+ (推荐 8GB)
存储: 2GB+ (模型文件)
网络: 仅当使用 MOSS 云端引擎时需要
```

### 7.3 快速启动

```bash
# 1. 安装依赖
uv sync

# 2. 启动服务
uv run python -m service.main

# 3. 健康检查
curl http://localhost:1921/health

# 4. 测试识别
curl -X POST http://localhost:1921/v1/asr/transcribe \
  -F "audio@test.wav" \
  -F "enable_diarization=true"
```

---

## 8. 项目价值总结

| 维度 | 价值 |
|------|------|
| **技术** | 完全本地化运行，数据不出设备；多引擎架构灵活可扩展 |
| **功能** | 语音识别 + 发言人分离一体化；支持实时流式识别 |
| **易用** | HTTP API 标准化；CLI 工具即装即用；systemd 自启动 |
| **开放** | 开源模型 + 开源代码；可自定义训练模型 |

---

## 9. 相关链接

- **项目路径**: `D:\project\exomind-model`
- **服务端口**: `1921`
- **API 文档**: `http://localhost:1921/docs`
- **Agent 文档**: `http://localhost:1921/v1/docs/agent`

---

*本文档由 Agent 扫描生成，用于架构迁移参考。*
