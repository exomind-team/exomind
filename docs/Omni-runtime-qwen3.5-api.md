Qwen-Omni-Realtime 是千问推出的实时音视频聊天模型。能同时理解流式的音频与图像输入（例如从视频流中实时抽取的连续图像帧），并实时输出高质量的文本与音频。

**支持的地域：**北京、新加坡，需使用各地域的 [API Key](https://help.aliyun.com/zh/model-studio/get-api-key)。

**在线体验：**请参见[如何在线体验 Qwen-Omni-Realtime 模型？](#14a119f447ehf)

## **如何使用**

### **1\. 建立连接**

Qwen-Omni-Realtime 模型通过 WebSocket 协议接入，可通过以下 Python 示例代码建立连接。也可通过DashScope SDK 建立连接。

**说明**

请注意，Qwen-Omni-Realtime 的单次 WebSocket 会话最长可持续 **120 分钟**。达到此上限后，服务将主动关闭连接。

## WebSocket 原生连接

连接时需要以下配置项：

| **配置项** | **说明**                                                                                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 调用地址         | 中国内地（北京）：wss://dashscope.aliyuncs.com/api-ws/v1/realtime 国际（新加坡）：wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime                                      |
| 查询参数         | 查询参数为model，需指定为访问的模型名。示例：`?model=qwen3.5-omni-plus-realtime`                                                                                          |
| 请求头           | 使用 Bearer Token 鉴权：Authorization: Bearer DASHSCOPE\\_API\\_KEY > DASHSCOPE\\_API\\_KEY 是您在百炼上申请的[API Key](https://help.aliyun.com/zh/model-studio/get-api-key)。 |

```
# pip install websocket-client
import json
import websocket
import os

API_KEY=os.getenv("DASHSCOPE_API_KEY")
API_URL = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen3.5-omni-plus-realtime"

headers = [
    "Authorization: Bearer " + API_KEY
]

def on_open(ws):
    print(f"Connected to server: {API_URL}")
def on_message(ws, message):
    data = json.loads(message)
    print("Received event:", json.dumps(data, indent=2))
def on_error(ws, error):
    print("Error:", error)

ws = websocket.WebSocketApp(
    API_URL,
    header=headers,
    on_open=on_open,
    on_message=on_message,
    on_error=on_error
)

ws.run_forever()
```

## DashScope SDK

Python

```
# SDK 版本不低于1.23.9
import os
import json
from dashscope.audio.qwen_omni import OmniRealtimeConversation,OmniRealtimeCallback
import dashscope
# 若没有配置 API Key，请将下行改为 dashscope.api_key = "sk-xxx"
dashscope.api_key = os.getenv("DASHSCOPE_API_KEY")

class PrintCallback(OmniRealtimeCallback):
    def on_open(self) -> None:
        print("Connected Successfully")
    def on_event(self, response: dict) -> None:
        print("Received event:")
        print(json.dumps(response, indent=2, ensure_ascii=False))
    def on_close(self, close_status_code: int, close_msg: str) -> None:
        print(f"Connection closed (code={close_status_code}, msg={close_msg}).")

callback = PrintCallback()
conversation = OmniRealtimeConversation(
    model="qwen3.5-omni-plus-realtime",
    callback=callback,
    # 以下为北京地域url，若使用新加坡地域的模型，需将url替换为：wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime
    url="wss://dashscope.aliyuncs.com/api-ws/v1/realtime"
)
try:
    conversation.connect()
    print("Conversation started. Press Ctrl+C to exit.")
    conversation.thread.join()
except KeyboardInterrupt:
    conversation.close()
```

Java

```
// SDK 版本不低于 2.20.9
import com.alibaba.dashscope.audio.omni.*;
import com.alibaba.dashscope.exception.NoApiKeyException;
import com.google.gson.JsonObject;
import java.util.concurrent.CountDownLatch;

public class Main {
    public static void main(String[] args) throws InterruptedException, NoApiKeyException {
        CountDownLatch latch = new CountDownLatch(1);
        OmniRealtimeParam param = OmniRealtimeParam.builder()
                .model("qwen3.5-omni-plus-realtime")
                .apikey(System.getenv("DASHSCOPE_API_KEY"))
                // 以下为北京地域url，若使用新加坡地域的模型，需将url替换为：wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime
                .url("wss://dashscope.aliyuncs.com/api-ws/v1/realtime")
                .build();

        OmniRealtimeConversation conversation = new OmniRealtimeConversation(param, new OmniRealtimeCallback() {
            @Override
            public void onOpen() {
                System.out.println("Connected Successfully");
            }
            @Override
            public void onEvent(JsonObject message) {
                System.out.println(message);
            }
            @Override
            public void onClose(int code, String reason) {
                System.out.println("connection closed code: " + code + ", reason: " + reason);
                latch.countDown();
            }
        });
        conversation.connect();
        latch.await();
        conversation.close(1000, "bye");
        System.exit(0);
    }
}
```

### **2\. 配置会话**

发送客户端事件[session.update](https://help.aliyun.com/zh/model-studio/client-events#26a8302028sjm)：

```
{
    // 该事件的id，由客户端生成
    "event_id": "event_ToPZqeobitzUJnt3QqtWg",
    // 事件类型，固定为session.update
    "type": "session.update",
    // 会话配置
    "session": {
        // 输出模态，支持设置为["text"]（仅输出文本）或["text","audio"]（输出文本与音频）。
        "modalities": [
            "text",
            "audio"
        ],
        // 输出音频的音色
        "voice": "Ethan",
        // 输入音频格式，当前仅支持设置为pcm。
        "input_audio_format": "pcm",
        // 输出音频格式，当前仅支持设置为pcm。
        "output_audio_format": "pcm",
        // 系统消息，用于设定模型的目标或角色。
        "instructions": "你是某五星级酒店的AI客服专员，请准确且友好地解答客户关于房型、设施、价格、预订政策的咨询。请始终以专业和乐于助人的态度回应，杜绝提供未经证实或超出酒店服务范围的信息。",
        // 是否开启语音活动检测。若需启用，需传入一个配置对象，服务端将据此自动检测语音起止。
        // 设置为null表示由客户端决定何时发起模型响应。
        "turn_detection": {
            // VAD类型，需设置为server_vad。
            "type": "server_vad",
            // VAD检测阈值。建议在嘈杂的环境中增加，在安静的环境中降低。
            "threshold": 0.5,
            // 检测语音停止的静音持续时间，超过此值后会触发模型响应
            "silence_duration_ms": 800
        }
    }
}
```

### **3\. 输入音频与图片**

客户端通过[input\_audio\_buffer.append](https://help.aliyun.com/zh/model-studio/client-events#2ea4b5e41fhjd)和 [input\_image\_buffer.append](https://help.aliyun.com/zh/model-studio/client-events#c28ed38410nfw) 事件发送 Base64 编码的音频和图片数据到服务端缓冲区。音频输入是必需的；图片输入是可选的。

> 图片可以来自本地文件，或从视频流中实时采集。

> 启用服务端VAD时，服务端会在检测到语音结束时自动提交数据并触发响应。禁用VAD时（手动模式），客户端必须在发送完数据后，主动调用[input\_audio\_buffer.commit](https://help.aliyun.com/zh/model-studio/client-events#1cbea5fa7fkfl)事件来提交。

### **4\. 接收模型响应**

模型的响应格式取决于配置的输出模态。

- **仅输出文本**

  通过[response.text.delta](https://help.aliyun.com/zh/model-studio/server-events#0c54be63e0c3w)事件接收流式文本，[response.text.done](https://help.aliyun.com/zh/model-studio/server-events#d675635a94jfb)事件获取完整文本。
- **输出文本+音频**

  - **文本**：通过[response.audio\_transcript.delta](https://help.aliyun.com/zh/model-studio/server-events#35396453cfood)事件接收流式文本，[response.audio\_transcript.done](https://help.aliyun.com/zh/model-studio/server-events#f4d1698567bsm)事件获取完整文本。
  - **音频**：通过[response.audio.delta](https://help.aliyun.com/zh/model-studio/server-events#a25cc50a15car)事件获取 Base64 编码的流式输出音频数据。[response.audio.done](https://help.aliyun.com/zh/model-studio/server-events#9e8eb59c67qnt)事件标志音频数据生成完成。

## **模型选型**

**说明**

Qwen3.5-Omni-Realtime 系列模型目前为邀测状态，模型调用限时免费（不包含工具调用费用，工具调用计费请参见[计费说明](https://help.aliyun.com/zh/model-studio/web-search#92ce83df3a599)）。

Qwen3.5-Omni-Realtime 是千问最新推出的实时多模态模型，相比于上一代的 Qwen3-Omni-Flash-Realtime：

- **智能水平**

  模型智力大幅提升，与 Qwen3.5-Plus 智能水平相当。
- **联网搜索**

  原生支持联网搜索（WebSearch），模型可自主判断是否需要搜索来回应即时问题。详见[联网搜索](#a8b2c3d4e5s6h)。
- **语义打断**

  自动识别对话意图，避免附和声和无意义背景音触发打断。
- **语音控制**

  通过语音指令控制声音大小、语速和情绪，如“语速快一些”、“声音大一些”、“用开心的语气”等。
- **支持的语言**

  支持 [113 种语种和方言](https://help.aliyun.com/zh/model-studio/qwen-omni#model-comparison-table)的语音识别，以及 [36 种语种和方言](https://help.aliyun.com/zh/model-studio/qwen-omni#model-comparison-table)的语音生成。
- **支持的音色**

  支持 55 种音色（47 种多语言 + 8 种方言），具体可查看[音色列表](#f4c9fd97f221z)。

模型的名称、上下文、价格、快照版本等信息请参见百炼控制台；并发限流条件请参考[限流](https://help.aliyun.com/zh/model-studio/rate-limit)。

## **快速开始**

您需要[获取API Key](https://help.aliyun.com/zh/model-studio/get-api-key)并[配置API Key到环境变量](https://help.aliyun.com/zh/model-studio/configure-api-key-through-environment-variables)。

请选择您熟悉的编程语言，通过以下步骤快速体验与 Realtime 模型实时对话的功能。

## DashScope Python SDK

- **准备运行环境**

您的 Python 版本需要不低于 3.10。

首先根据您的操作系统安装 pyaudio。

## macOS

```
brew install portaudio && pip install pyaudio
```

## Debian/Ubuntu

- **若未使用虚拟环境**，可直接通过系统包管理器安装：

  ```
  sudo apt-get install python3-pyaudio
  ```
- **若使用虚拟环境**，需先安装编译依赖：

  ```
  sudo apt update
  sudo apt install -y python3-dev portaudio19-dev
  ```

  然后在已激活的虚拟环境中使用 pip 安装：

  ```
  pip install pyaudio
  ```

## CentOS

```
sudo yum install -y portaudio portaudio-devel && pip install pyaudio
```

## Windows

```
pip install pyaudio
```

安装完成后，通过 pip 安装依赖：

```
pip install websocket-client dashscope
```

- **选择交互模式**

  - VAD 模式（Voice Activity Detection，自动检测语音起止）

    服务端自动判断用户何时开始与停止说话并作出回应。
  - Manual 模式（按下即说，松开即发送）

    客户端控制语音起止。用户说话结束后，客户端需主动发送消息至服务端。

  ## VAD 模式

  新建一个 python 文件，命名为vad\_dash.py，并将以下代码复制到文件中：

  vad\_dash.py


  ```
  # 依赖：dashscope >= 1.23.9，pyaudio
  import os
  import base64
  import time
  import pyaudio
  from dashscope.audio.qwen_omni import MultiModality, AudioFormat,OmniRealtimeCallback,OmniRealtimeConversation
  import dashscope

  # 配置参数：地址、API Key、音色、模型、模型角色
  # 指定地域，设为cn表示中国内地（北京），设为intl表示国际（新加坡）
  region = 'cn'
  base_domain = 'dashscope.aliyuncs.com' if region == 'cn' else 'dashscope-intl.aliyuncs.com'
  url = f'wss://{base_domain}/api-ws/v1/realtime'
  # 配置 API Key，若没有设置环境变量，请用 API Key 将下行替换为 dashscope.api_key = "sk-xxx"
  dashscope.api_key = os.getenv('DASHSCOPE_API_KEY')
  # 指定音色
  voice = 'Ethan'
  # 指定模型
  model = 'qwen3.5-omni-plus-realtime'
  # 指定模型角色
  instructions = "你是个人助理小云，请用幽默风趣的方式回答用户的问题"
  class SimpleCallback(OmniRealtimeCallback):
      def __init__(self, pya):
          self.pya = pya
          self.out = None
      def on_open(self):
          # 初始化音频输出流
          self.out = self.pya.open(
              format=pyaudio.paInt16,
              channels=1,
              rate=24000,
              output=True
          )
      def on_event(self, response):
          if response['type'] == 'response.audio.delta':
              # 播放音频
              self.out.write(base64.b64decode(response['delta']))
          elif response['type'] == 'conversation.item.input_audio_transcription.completed':
              # 打印转录文本
              print(f"[User] {response['transcript']}")
          elif response['type'] == 'response.audio_transcript.done':
              # 打印助手回复文本
              print(f"[LLM] {response['transcript']}")

  # 1. 初始化音频设备
  pya = pyaudio.PyAudio()
  # 2. 创建回调函数和会话
  callback = SimpleCallback(pya)
  conv = OmniRealtimeConversation(model=model, callback=callback, url=url)
  # 3. 建立连接并配置会话
  conv.connect()
  conv.update_session(output_modalities=[MultiModality.AUDIO, MultiModality.TEXT], voice=voice, instructions=instructions)
  # 4. 初始化音频输入流
  mic = pya.open(format=pyaudio.paInt16, channels=1, rate=16000, input=True)
  # 5. 主循环处理音频输入
  print("对话已开始，对着麦克风说话 (Ctrl+C 退出)...")
  try:
      while True:
          audio_data = mic.read(3200, exception_on_overflow=False)
          conv.append_audio(base64.b64encode(audio_data).decode())
          time.sleep(0.01)
  except KeyboardInterrupt:
      # 清理资源
      conv.close()
      mic.close()
      callback.out.close()
      pya.terminate()
      print("\n对话结束")
  ```

  运行 `vad_dash.py`，通过麦克风即可与 Qwen-Omni-Realtime 模型实时对话，系统会检测您的音频起始位置并自动发送到服务器，无需您手动发送。

  ## Manual 模式

  新建一个 python 文件，命名为 `manual_dash.py`，并将以下代码复制进文件中：

  manual\_dash.py

  ```
  # 依赖：dashscope >= 1.23.9，pyaudio。
  import os
  import base64
  import sys
  import threading
  import pyaudio
  from dashscope.audio.qwen_omni import *
  import dashscope

  # 如果没有设置环境变量，请用您的 API Key 将下行替换为 dashscope.api_key = "sk-xxx"
  dashscope.api_key = os.getenv('DASHSCOPE_API_KEY')
  voice = 'Ethan'

  class MyCallback(OmniRealtimeCallback):
      """最简回调：建立连接时初始化扬声器，事件中直接播放返回音频。"""
      def __init__(self, ctx):
          super().__init__()
          self.ctx = ctx

      def on_open(self) -> None:
          # 连接建立后初始化 PyAudio 与扬声器(24k/mono/16bit)
          print('connection opened')
          try:
              self.ctx['pya'] = pyaudio.PyAudio()
              self.ctx['out'] = self.ctx['pya'].open(
                  format=pyaudio.paInt16,
                  channels=1,
                  rate=24000,
                  output=True
              )
              print('audio output initialized')
          except Exception as e:
              print('[Error] audio init failed: {}'.format(e))

      def on_close(self, close_status_code, close_msg) -> None:
          print('connection closed with code: {}, msg: {}'.format(close_status_code, close_msg))
          sys.exit(0)

      def on_event(self, response: str) -> None:
          try:
              t = response['type']
              handlers = {
                  'session.created': lambda r: print('start session: {}'.format(r['session']['id'])),
                  'conversation.item.input_audio_transcription.completed': lambda r: print('question: {}'.format(r['transcript'])),
                  'response.audio_transcript.delta': lambda r: print('llm text: {}'.format(r['delta'])),
                  'response.audio.delta': self._play_audio,
                  'response.done': self._response_done,
              }
              h = handlers.get(t)
              if h:
                  h(response)
          except Exception as e:
              print('[Error] {}'.format(e))

      def _play_audio(self, response):
          # 直接解码base64并写入输出流进行播放
          if self.ctx['out'] is None:
              return
          try:
              data = base64.b64decode(response['delta'])
              self.ctx['out'].write(data)
          except Exception as e:
              print('[Error] audio playback failed: {}'.format(e))

      def _response_done(self, response):
          # 标记本轮对话完成，用于主循环等待
          if self.ctx['conv'] is not None:
              print('[Metric] response: {}, first text delay: {}, first audio delay: {}'.format(
                  self.ctx['conv'].get_last_response_id(),
                  self.ctx['conv'].get_last_first_text_delay(),
                  self.ctx['conv'].get_last_first_audio_delay(),
              ))
          if self.ctx['resp_done'] is not None:
              self.ctx['resp_done'].set()

  def shutdown_ctx(ctx):
      """安全释放音频与PyAudio资源。"""
      try:
          if ctx['out'] is not None:
              ctx['out'].close()
              ctx['out'] = None
      except Exception:
          pass
      try:
          if ctx['pya'] is not None:
              ctx['pya'].terminate()
              ctx['pya'] = None
      except Exception:
          pass


  def record_until_enter(pya_inst: pyaudio.PyAudio, sample_rate=16000, chunk_size=3200):
      """按 Enter 停止录音，返回PCM字节。"""
      frames = []
      stop_evt = threading.Event()

      stream = pya_inst.open(
          format=pyaudio.paInt16,
          channels=1,
          rate=sample_rate,
          input=True,
          frames_per_buffer=chunk_size
      )

      def _reader():
          while not stop_evt.is_set():
              try:
                  frames.append(stream.read(chunk_size, exception_on_overflow=False))
              except Exception:
                  break

      t = threading.Thread(target=_reader, daemon=True)
      t.start()
      input()  # 用户再次按 Enter 停止录音
      stop_evt.set()
      t.join(timeout=1.0)
      try:
          stream.close()
      except Exception:
          pass
      return b''.join(frames)


  if __name__  == '__main__':
      print('Initializing ...')
      # 运行时上下文：存放音频与会话句柄
      ctx = {'pya': None, 'out': None, 'conv': None, 'resp_done': threading.Event()}
      callback = MyCallback(ctx)
      conversation = OmniRealtimeConversation(
          model='qwen3.5-omni-plus-realtime',
          callback=callback,
          # 以下为北京地域url，若使用新加坡地域的模型，需将url替换为：wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime
          url="wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
      )
      try:
          conversation.connect()
      except Exception as e:
          print('[Error] connect failed: {}'.format(e))
          sys.exit(1)

      ctx['conv'] = conversation
      # 会话配置：启用文本+音频输出（禁用服务端VAD，改为手动录音）
      conversation.update_session(
          output_modalities=[MultiModality.AUDIO, MultiModality.TEXT],
          voice=voice,
          enable_input_audio_transcription=True,
          # 对输入音频做语音转录的模型，仅支持gummy-realtime-v1
          input_audio_transcription_model='gummy-realtime-v1',
          enable_turn_detection=False,
          instructions="你是个人助理小云，请你准确且友好地解答用户的问题，始终以乐于助人的态度回应。"
      )

      try:
          turn = 1
          while True:
              print(f"\n--- 第 {turn} 轮对话 ---")
              print("按 Enter 开始录音（输入 q 回车退出）...")
              user_input = input()
              if user_input.strip().lower() in ['q', 'quit']:
                  print("用户请求退出...")
                  break
              print("录音中... 再次按 Enter 停止录音。")
              if ctx['pya'] is None:
                  ctx['pya'] = pyaudio.PyAudio()
              recorded = record_until_enter(ctx['pya'])
              if not recorded:
                  print("未录制到有效音频，请重试。")
                  continue
              print(f"成功录制音频: {len(recorded)} 字节，发送中...")

              # 以3200字节为块发送（对应16k/16bit/100ms）
              chunk_size = 3200
              for i in range(0, len(recorded), chunk_size):
                  chunk = recorded[i:i+chunk_size]
                  conversation.append_audio(base64.b64encode(chunk).decode('ascii'))

              print("发送完成，等待模型响应...")
              ctx['resp_done'].clear()
              conversation.commit()
              conversation.create_response()
              ctx['resp_done'].wait()
              print('播放音频完成')
              turn += 1
      except KeyboardInterrupt:
          print("\n程序被用户中断")
      finally:
          shutdown_ctx(ctx)
          print("程序退出")
  ```

  运行 `manual_dash.py`，按 Enter 键开始说话，再按一次获取模型响应的音频。

## DashScope Java SDK

**选择交互模式**

- VAD 模式（Voice Activity Detection，自动检测语音起止）

  Realtime API 自动判断用户何时开始与停止说话并作出回应。
- Manual 模式（按下即说，松开即发送）

  客户端控制语音起止。用户说话结束后，客户端需主动发送消息至服务端。

## VAD 模式

OmniServerVad.java

```
import com.alibaba.dashscope.audio.omni.*;
import com.alibaba.dashscope.exception.NoApiKeyException;
import com.google.gson.JsonObject;
import javax.sound.sampled.*;
import java.nio.ByteBuffer;
import java.util.Arrays;
import java.util.Base64;
import java.util.Map;
import java.util.Queue;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.atomic.AtomicBoolean;

public class OmniServerVad {
    static class SequentialAudioPlayer {
        private final SourceDataLine line;
        private final Queue<byte[]> audioQueue = new ConcurrentLinkedQueue<>();
        private final Thread playerThread;
        private final AtomicBoolean shouldStop = new AtomicBoolean(false);

        public SequentialAudioPlayer() throws LineUnavailableException {
            AudioFormat format = new AudioFormat(24000, 16, 1, true, false);
            line = AudioSystem.getSourceDataLine(format);
            line.open(format);
            line.start();

            playerThread = new Thread(() -> {
                while (!shouldStop.get()) {
                    byte[] audio = audioQueue.poll();
                    if (audio != null) {
                        line.write(audio, 0, audio.length);
                    } else {
                        try { Thread.sleep(10); } catch (InterruptedException ignored) {}
                    }
                }
            }, "AudioPlayer");
            playerThread.start();
        }

        public void play(String base64Audio) {
            try {
                byte[] audio = Base64.getDecoder().decode(base64Audio);
                audioQueue.add(audio);
            } catch (Exception e) {
                System.err.println("音频解码失败: " + e.getMessage());
            }
        }

        public void cancel() {
            audioQueue.clear();
            line.flush();
        }

        public void close() {
            shouldStop.set(true);
            try { playerThread.join(1000); } catch (InterruptedException ignored) {}
            line.drain();
            line.close();
        }
    }

    public static void main(String[] args) {
        try {
            SequentialAudioPlayer player = new SequentialAudioPlayer();
            AtomicBoolean userIsSpeaking = new AtomicBoolean(false);
            AtomicBoolean shouldStop = new AtomicBoolean(false);

            OmniRealtimeParam param = OmniRealtimeParam.builder()
                    .model("qwen3.5-omni-plus-realtime")
                    .apikey(System.getenv("DASHSCOPE_API_KEY"))
                    // 以下为中国内地（北京）地域url，若使用国际（新加坡）地域的模型，需将url替换为：wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime
                    .url("wss://dashscope.aliyuncs.com/api-ws/v1/realtime")
                    .build();

            OmniRealtimeConversation conversation = new OmniRealtimeConversation(param, new OmniRealtimeCallback() {
                @Override public void onOpen() {
                    System.out.println("连接已建立");
                }
                @Override public void onClose(int code, String reason) {
                    System.out.println("连接已关闭 (" + code + "): " + reason);
                    shouldStop.set(true);
                }
                @Override public void onEvent(JsonObject event) {
                    handleEvent(event, player, userIsSpeaking);
                }
            });

            conversation.connect();
            conversation.updateSession(OmniRealtimeConfig.builder()
                    .modalities(Arrays.asList(OmniRealtimeModality.AUDIO, OmniRealtimeModality.TEXT))
                    .voice("Ethan")
                    .enableTurnDetection(true)
                    .enableInputAudioTranscription(true)
                    .parameters(Map.of("instructions",
                            "你是五星级酒店的AI客服专员，请准确且友好地解答客户关于房型、设施、价格、预订政策的咨询。请始终以专业和乐于助人的态度回应，杜绝提供未经证实或超出酒店服务范围的信息。"))
                    .build()
            );

            System.out.println("请开始说话（自动检测语音开始/结束，按Ctrl+C退出）...");
            AudioFormat format = new AudioFormat(16000, 16, 1, true, false);
            TargetDataLine mic = AudioSystem.getTargetDataLine(format);
            mic.open(format);
            mic.start();

            ByteBuffer buffer = ByteBuffer.allocate(3200);
            while (!shouldStop.get()) {
                int bytesRead = mic.read(buffer.array(), 0, buffer.capacity());
                if (bytesRead > 0) {
                    try {
                        conversation.appendAudio(Base64.getEncoder().encodeToString(buffer.array()));
                    } catch (Exception e) {
                        if (e.getMessage() != null && e.getMessage().contains("closed")) {
                            System.out.println("对话已关闭，停止录音");
                            break;
                        }
                    }
                }
                Thread.sleep(20);
            }

            conversation.close(1000, "正常结束");
            player.close();
            mic.close();
            System.out.println("\n程序已退出");

        } catch (NoApiKeyException e) {
            System.err.println("未找到API KEY: 请设置环境变量 DASHSCOPE_API_KEY");
            System.exit(1);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private static void handleEvent(JsonObject event, SequentialAudioPlayer player, AtomicBoolean userIsSpeaking) {
        String type = event.get("type").getAsString();
        switch (type) {
            case "input_audio_buffer.speech_started":
                System.out.println("\n[用户开始说话]");
                player.cancel();
                userIsSpeaking.set(true);
                break;
            case "input_audio_buffer.speech_stopped":
                System.out.println("[用户停止说话]");
                userIsSpeaking.set(false);
                break;
            case "response.audio.delta":
                if (!userIsSpeaking.get()) {
                    player.play(event.get("delta").getAsString());
                }
                break;
            case "conversation.item.input_audio_transcription.completed":
                System.out.println("用户: " + event.get("transcript").getAsString());
                break;
            case "response.audio_transcript.delta":
                System.out.print(event.get("delta").getAsString());
                break;
            case "response.done":
                System.out.println("回复完成");
                break;
        }
    }
}
```

运行 `OmniServerVad.main()`方法，通过麦克风即可与 Realtime 模型实时对话，系统会检测您的音频起始位置并自动发送到服务器，无需您手动发送。

## Manual 模式

OmniWithoutServerVad.java

```
// DashScope Java SDK 版本不低于2.20.9

import com.alibaba.dashscope.audio.omni.*;
import com.alibaba.dashscope.exception.NoApiKeyException;
import com.google.gson.JsonObject;
import javax.sound.sampled.*;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashMap;
import java.util.Queue;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

public class OmniWithoutServerVad {
    // RealtimePcmPlayer 类定义开始
    public static class RealtimePcmPlayer {
        private int sampleRate;
        private SourceDataLine line;
        private AudioFormat audioFormat;
        private Thread decoderThread;
        private Thread playerThread;
        private AtomicBoolean stopped = new AtomicBoolean(false);
        private Queue<String> b64AudioBuffer = new ConcurrentLinkedQueue<>();
        private Queue<byte[]> RawAudioBuffer = new ConcurrentLinkedQueue<>();

        // 构造函数初始化音频格式和音频线路
        public RealtimePcmPlayer(int sampleRate) throws LineUnavailableException {
            this.sampleRate = sampleRate;
            this.audioFormat = new AudioFormat(this.sampleRate, 16, 1, true, false);
            DataLine.Info info = new DataLine.Info(SourceDataLine.class, audioFormat);
            line = (SourceDataLine) AudioSystem.getLine(info);
            line.open(audioFormat);
            line.start();
            decoderThread = new Thread(new Runnable() {
                @Override
                public void run() {
                    while (!stopped.get()) {
                        String b64Audio = b64AudioBuffer.poll();
                        if (b64Audio != null) {
                            byte[] rawAudio = Base64.getDecoder().decode(b64Audio);
                            RawAudioBuffer.add(rawAudio);
                        } else {
                            try {
                                Thread.sleep(100);
                            } catch (InterruptedException e) {
                                throw new RuntimeException(e);
                            }
                        }
                    }
                }
            });
            playerThread = new Thread(new Runnable() {
                @Override
                public void run() {
                    while (!stopped.get()) {
                        byte[] rawAudio = RawAudioBuffer.poll();
                        if (rawAudio != null) {
                            try {
                                playChunk(rawAudio);
                            } catch (IOException e) {
                                throw new RuntimeException(e);
                            } catch (InterruptedException e) {
                                throw new RuntimeException(e);
                            }
                        } else {
                            try {
                                Thread.sleep(100);
                            } catch (InterruptedException e) {
                                throw new RuntimeException(e);
                            }
                        }
                    }
                }
            });
            decoderThread.start();
            playerThread.start();
        }

        // 播放一个音频块并阻塞直到播放完成
        private void playChunk(byte[] chunk) throws IOException, InterruptedException {
            if (chunk == null || chunk.length == 0) return;

            int bytesWritten = 0;
            while (bytesWritten < chunk.length) {
                bytesWritten += line.write(chunk, bytesWritten, chunk.length - bytesWritten);
            }
            int audioLength = chunk.length / (this.sampleRate*2/1000);
            // 等待缓冲区中的音频播放完成
            Thread.sleep(audioLength - 10);
        }

        public void write(String b64Audio) {
            b64AudioBuffer.add(b64Audio);
        }

        public void cancel() {
            b64AudioBuffer.clear();
            RawAudioBuffer.clear();
        }

        public void waitForComplete() throws InterruptedException {
            while (!b64AudioBuffer.isEmpty() || !RawAudioBuffer.isEmpty()) {
                Thread.sleep(100);
            }
            line.drain();
        }

        public void shutdown() throws InterruptedException {
            stopped.set(true);
            decoderThread.join();
            playerThread.join();
            if (line != null && line.isRunning()) {
                line.drain();
                line.close();
            }
        }
    } // RealtimePcmPlayer 类定义结束
    // 新增录音方法
    private static void recordAndSend(TargetDataLine line, OmniRealtimeConversation conversation) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[3200];
        AtomicBoolean stopRecording = new AtomicBoolean(false);

        // 启动监听Enter键的线程
        Thread enterKeyListener = new Thread(() -> {
            try {
                System.in.read();
                stopRecording.set(true);
            } catch (IOException e) {
                e.printStackTrace();
            }
        });
        enterKeyListener.start();

        // 录音循环
        while (!stopRecording.get()) {
            int count = line.read(buffer, 0, buffer.length);
            if (count > 0) {
                out.write(buffer, 0, count);
            }
        }

        // 发送录音数据
        byte[] audioData = out.toByteArray();
        String audioB64 = Base64.getEncoder().encodeToString(audioData);
        conversation.appendAudio(audioB64);
        out.close();
    }

    public static void main(String[] args) throws InterruptedException, LineUnavailableException {
        OmniRealtimeParam param = OmniRealtimeParam.builder()
                .model("qwen3.5-omni-plus-realtime")
                // .apikey("your-dashscope-api-key")
                .build();
        AtomicReference<CountDownLatch> responseDoneLatch = new AtomicReference<>(null);
        responseDoneLatch.set(new CountDownLatch(1));

        RealtimePcmPlayer audioPlayer = new RealtimePcmPlayer(24000);
        final AtomicReference<OmniRealtimeConversation> conversationRef = new AtomicReference<>(null);
        OmniRealtimeConversation conversation = new OmniRealtimeConversation(param, new OmniRealtimeCallback() {
            @Override
            public void onOpen() {
                System.out.println("connection opened");
            }
            @Override
            public void onEvent(JsonObject message) {
                String type = message.get("type").getAsString();
                switch(type) {
                    case "session.created":
                        System.out.println("start session: " + message.get("session").getAsJsonObject().get("id").getAsString());
                        break;
                    case "conversation.item.input_audio_transcription.completed":
                        System.out.println("question: " + message.get("transcript").getAsString());
                        break;
                    case "response.audio_transcript.delta":
                        System.out.println("got llm response delta: " + message.get("delta").getAsString());
                        break;
                    case "response.audio.delta":
                        String recvAudioB64 = message.get("delta").getAsString();
                        audioPlayer.write(recvAudioB64);
                        break;
                    case "response.done":
                        System.out.println("======RESPONSE DONE======");
                        if (conversationRef.get() != null) {
                            System.out.println("[Metric] response: " + conversationRef.get().getResponseId() +
                                    ", first text delay: " + conversationRef.get().getFirstTextDelay() +
                                    " ms, first audio delay: " + conversationRef.get().getFirstAudioDelay() + " ms");
                        }
                        responseDoneLatch.get().countDown();
                        break;
                    default:
                        break;
                }
            }
            @Override
            public void onClose(int code, String reason) {
                System.out.println("connection closed code: " + code + ", reason: " + reason);
            }
        });
        conversationRef.set(conversation);
        try {
            conversation.connect();
        } catch (NoApiKeyException e) {
            throw new RuntimeException(e);
        }
        OmniRealtimeConfig config = OmniRealtimeConfig.builder()
                .modalities(Arrays.asList(OmniRealtimeModality.AUDIO, OmniRealtimeModality.TEXT))
                .voice("Ethan")
                .enableTurnDetection(false)
                // 设定模型角色
                .parameters(new HashMap<String, Object>() {{
                    put("instructions","你是个人助理小云，请你准确且友好地解答用户的问题，始终以乐于助人的态度回应。");
                }})
                .build();
        conversation.updateSession(config);

        // 新增麦克风录音功能
        AudioFormat format = new AudioFormat(16000, 16, 1, true, false);
        DataLine.Info info = new DataLine.Info(TargetDataLine.class, format);
      
        if (!AudioSystem.isLineSupported(info)) {
            System.out.println("Line not supported");
            return;
        }
      
        TargetDataLine line = null;
        try {
            line = (TargetDataLine) AudioSystem.getLine(info);
            line.open(format);
            line.start();
          
            while (true) {
                System.out.println("按Enter开始录音...");
                try {
                    System.in.read();
                } catch (IOException e) {
                    System.err.println("读取输入时发生错误: " + e.getMessage());
                    break; // 发生错误时退出循环
                }
                System.out.println("开始录音，请说话...再次按Enter停止录音并发送");
                recordAndSend(line, conversation);
                conversation.commit();
                conversation.createResponse(null, null);
                // 重置latch以便下次等待
                responseDoneLatch.set(new CountDownLatch(1));
            }
        } catch (LineUnavailableException | IOException e) {
            e.printStackTrace();
        } finally {
            if (line != null) {
                line.stop();
                line.close();
            }
        }
    }}
```

运行 `OmniWithoutServerVad.main()`方法，按 Enter 键开始录音，录音过程中再次按 Enter 键停止录音并发送，随后将接收并播放模型响应。

## WebSocket（Python）

- **准备运行环境**

  您的 Python 版本需要不低于 3.10。

  首先根据您的操作系统来安装 pyaudio。

  ## macOS


  ```
  brew install portaudio && pip install pyaudio
  ```

  ## Debian/Ubuntu

  ```
  sudo apt-get install python3-pyaudio

  或者

  pip install pyaudio
  ```

  > 推荐使用 `pip install pyaudio`。如果安装失败，请先根据您的操作系统安装 `portaudio`依赖。
  >

  ## CentOS

  ```
  sudo yum install -y portaudio portaudio-devel && pip install pyaudio
  ```

  ## Windows

  ```
  pip install pyaudio
  ```

  安装完成后，通过 pip 安装 websocket 相关的依赖：

  ```
  pip install websockets==15.0.1
  ```
- **创建客户端**

  在本地新建一个 python 文件，命名为 `omni_realtime_client.py`，并将以下代码复制进文件中：

  omni\_realtime\_client.py

  ```
  import asyncio
  import websockets
  import json
  import base64
  import time
  from typing import Optional, Callable, List, Dict, Any
  from enum import Enum

  class TurnDetectionMode(Enum):
      SERVER_VAD = "server_vad"
      MANUAL = "manual"

  class OmniRealtimeClient:

      def __init__(
              self,
              base_url,
              api_key: str,
              model: str = "",
              voice: str = "Ethan",
              instructions: str = "You are a helpful assistant.",
              turn_detection_mode: TurnDetectionMode = TurnDetectionMode.SERVER_VAD,
              on_text_delta: Optional[Callable[[str], None]] = None,
              on_audio_delta: Optional[Callable[[bytes], None]] = None,
              on_input_transcript: Optional[Callable[[str], None]] = None,
              on_output_transcript: Optional[Callable[[str], None]] = None,
              extra_event_handlers: Optional[Dict[str, Callable[[Dict[str, Any]], None]]] = None
      ):
          self.base_url = base_url
          self.api_key = api_key
          self.model = model
          self.voice = voice
          self.instructions = instructions
          self.ws = None
          self.on_text_delta = on_text_delta
          self.on_audio_delta = on_audio_delta
          self.on_input_transcript = on_input_transcript
          self.on_output_transcript = on_output_transcript
          self.turn_detection_mode = turn_detection_mode
          self.extra_event_handlers = extra_event_handlers or {}

          # 当前回复状态
          self._current_response_id = None
          self._current_item_id = None
          self._is_responding = False
          # 输入/输出转录打印状态
          self._print_input_transcript = True
          self._output_transcript_buffer = ""

      async def connect(self) -> None:
          """与 Realtime API 建立 WebSocket 连接。"""
          url = f"{self.base_url}?model={self.model}"
          headers = {
              "Authorization": f"Bearer {self.api_key}"
          }
          self.ws = await websockets.connect(url, additional_headers=headers)

          # 会话配置
          session_config = {
              "modalities": ["text", "audio"],
              "voice": self.voice,
              "instructions": self.instructions,
              "input_audio_format": "pcm",
              "output_audio_format": "pcm",
              "input_audio_transcription": {
                  "model": "gummy-realtime-v1"
              }
          }

          if self.turn_detection_mode == TurnDetectionMode.MANUAL:
              session_config['turn_detection'] = None
              await self.update_session(session_config)
          elif self.turn_detection_mode == TurnDetectionMode.SERVER_VAD:
              session_config['turn_detection'] = {
                  "type": "server_vad",
                  "threshold": 0.1,
                  "prefix_padding_ms": 500,
                  "silence_duration_ms": 900
              }
              await self.update_session(session_config)
          else:
              raise ValueError(f"Invalid turn detection mode: {self.turn_detection_mode}")

      async def send_event(self, event) -> None:
          event['event_id'] = "event_" + str(int(time.time() * 1000))
          await self.ws.send(json.dumps(event))

      async def update_session(self, config: Dict[str, Any]) -> None:
          """更新会话配置。"""
          event = {
              "type": "session.update",
              "session": config
          }
          await self.send_event(event)

      async def stream_audio(self, audio_chunk: bytes) -> None:
          """向 API 流式发送原始音频数据。"""
          # 仅支持 16bit 16kHz 单声道 PCM
          audio_b64 = base64.b64encode(audio_chunk).decode()
          append_event = {
              "type": "input_audio_buffer.append",
              "audio": audio_b64
          }
          await self.send_event(append_event)

      async def commit_audio_buffer(self) -> None:
          """提交音频缓冲区以触发处理。"""
          event = {
              "type": "input_audio_buffer.commit"
          }
          await self.send_event(event)

      async def append_image(self, image_chunk: bytes) -> None:
          """向图像缓冲区追加图像数据。
          图像数据可以来自本地文件，也可以来自实时视频流。
          注意:
              - 图像格式必须为 JPG 或 JPEG。推荐分辨率为 480P 或 720P，最高支持 1080P。
              - 单张图片大小不应超过 500KB。
              - 将图像数据编码为 Base64 后再发送。
              - 建议以 1张/秒 的频率向服务端发送图像。
              - 在发送图像数据之前，需要至少发送过一次音频数据。
          """
          image_b64 = base64.b64encode(image_chunk).decode()
          event = {
              "type": "input_image_buffer.append",
              "image": image_b64
          }
          await self.send_event(event)

      async def create_response(self) -> None:
          """向 API 请求生成回复（仅在手动模式下需要调用）。"""
          event = {
              "type": "response.create"
          }
          await self.send_event(event)

      async def cancel_response(self) -> None:
          """取消当前回复。"""
          event = {
              "type": "response.cancel"
          }
          await self.send_event(event)

      async def handle_interruption(self):
          """处理用户对当前回复的打断。"""
          if not self._is_responding:
              return
          # 1. 取消当前回复
          if self._current_response_id:
              await self.cancel_response()

          self._is_responding = False
          self._current_response_id = None
          self._current_item_id = None

      async def handle_messages(self) -> None:
          try:
              async for message in self.ws:
                  event = json.loads(message)
                  event_type = event.get("type")
                  if event_type == "error":
                      print(" Error: ", event['error'])
                      continue
                  elif event_type == "response.created":
                      self._current_response_id = event.get("response", {}).get("id")
                      self._is_responding = True
                  elif event_type == "response.output_item.added":
                      self._current_item_id = event.get("item", {}).get("id")
                  elif event_type == "response.done":
                      self._is_responding = False
                      self._current_response_id = None
                      self._current_item_id = None
                  elif event_type == "input_audio_buffer.speech_started":
                      print("检测到语音开始")
                      if self._is_responding:
                          print("处理打断")
                          await self.handle_interruption()
                  elif event_type == "input_audio_buffer.speech_stopped":
                      print("检测到语音结束")
                  elif event_type == "response.text.delta":
                      if self.on_text_delta:
                          self.on_text_delta(event["delta"])
                  elif event_type == "response.audio.delta":
                      if self.on_audio_delta:
                          audio_bytes = base64.b64decode(event["delta"])
                          self.on_audio_delta(audio_bytes)
                  elif event_type == "conversation.item.input_audio_transcription.completed":
                      transcript = event.get("transcript", "")
                      print(f"用户: {transcript}")
                      if self.on_input_transcript:
                          await asyncio.to_thread(self.on_input_transcript, transcript)
                          self._print_input_transcript = True
                  elif event_type == "response.audio_transcript.delta":
                      if self.on_output_transcript:
                          delta = event.get("delta", "")
                          if not self._print_input_transcript:
                              self._output_transcript_buffer += delta
                          else:
                              if self._output_transcript_buffer:
                                  await asyncio.to_thread(self.on_output_transcript, self._output_transcript_buffer)
                                  self._output_transcript_buffer = ""
                              await asyncio.to_thread(self.on_output_transcript, delta)
                  elif event_type == "response.audio_transcript.done":
                      print(f"大模型: {event.get('transcript', '')}")
                      self._print_input_transcript = False
                  elif event_type in self.extra_event_handlers:
                      self.extra_event_handlers[event_type](event)
          except websockets.exceptions.ConnectionClosed:
              print(" Connection closed")
          except Exception as e:
              print(" Error in message handling: ", str(e))
      async def close(self) -> None:
          """关闭 WebSocket 连接。"""
          if self.ws:
              await self.ws.close()
  ```
- **选择交互模式**

  - VAD 模式（Voice Activity Detection，自动检测语音起止）

    Realtime API 自动判断用户何时开始与停止说话并作出回应。
  - Manual 模式（按下即说，松开即发送）

    客户端控制语音起止。用户说话结束后，客户端需主动发送消息至服务端。

  ## VAD 模式

  在 `omni_realtime_client.py`的同级目录下新建另一个 python 文件，命名为 `vad_mode.py`，并将以下代码复制进文件中：

  vad\_mode.py


  ```
  # -- coding: utf-8 --
  import os, asyncio, pyaudio, queue, threading
  from omni_realtime_client import OmniRealtimeClient, TurnDetectionMode

  # 音频播放器类（处理中断）
  class AudioPlayer:
      def __init__(self, pyaudio_instance, rate=24000):
          self.stream = pyaudio_instance.open(format=pyaudio.paInt16, channels=1, rate=rate, output=True)
          self.queue = queue.Queue()
          self.stop_evt = threading.Event()
          self.interrupt_evt = threading.Event()
          threading.Thread(target=self._run, daemon=True).start()

      def _run(self):
          while not self.stop_evt.is_set():
              try:
                  data = self.queue.get(timeout=0.5)
                  if data is None: break
                  if not self.interrupt_evt.is_set(): self.stream.write(data)
                  self.queue.task_done()
              except queue.Empty: continue

      def add_audio(self, data): self.queue.put(data)
      def handle_interrupt(self): self.interrupt_evt.set(); self.queue.queue.clear()
      def stop(self): self.stop_evt.set(); self.queue.put(None); self.stream.stop_stream(); self.stream.close()

  # 麦克风录音并发送
  async def record_and_send(client):
      p = pyaudio.PyAudio()
      stream = p.open(format=pyaudio.paInt16, channels=1, rate=16000, input=True, frames_per_buffer=3200)
      print("开始录音，请讲话...")
      try:
          while True:
              audio_data = stream.read(3200)
              await client.stream_audio(audio_data)
              await asyncio.sleep(0.02)
      finally:
          stream.stop_stream(); stream.close(); p.terminate()

  async def main():
      p = pyaudio.PyAudio()
      player = AudioPlayer(pyaudio_instance=p)

      client = OmniRealtimeClient(
          # 以下是中国内地（北京）地域 base_url，国际（新加坡）地域base_url为wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime
          base_url="wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
          api_key=os.environ.get("DASHSCOPE_API_KEY"),
          model="qwen3.5-omni-plus-realtime",
          voice="Ethan",
          instructions="你是小云，风趣幽默的好助手",
          turn_detection_mode=TurnDetectionMode.SERVER_VAD,
          on_text_delta=lambda t: print(f"\nAssistant: {t}", end="", flush=True),
          on_audio_delta=player.add_audio,
      )

      await client.connect()
      print("连接成功，开始实时对话...")

      # 并发运行
      await asyncio.gather(client.handle_messages(), record_and_send(client))

  if __name__ == "__main__":
      try:
          asyncio.run(main())
      except KeyboardInterrupt:
          print("\n程序已退出。")
  ```

  运行 `vad_mode.py`，通过麦克风即可与 Realtime 模型实时对话，系统会检测您的音频起始位置并自动发送到服务器，无需您手动发送。

  ## Manual 模式

  在 `omni_realtime_client.py`的同级目录下新建另一个 python 文件，命名为 `manual_mode.py`，并将以下代码复制进文件中：

  manual\_mode.py

  ```
  # -- coding: utf-8 --
  import os
  import asyncio
  import time
  import threading
  import queue
  import pyaudio
  from omni_realtime_client import OmniRealtimeClient, TurnDetectionMode

  class AudioPlayer:
      """实时音频播放器类"""
      def __init__(self, sample_rate=24000, channels=1, sample_width=2):
          self.sample_rate = sample_rate
          self.channels = channels
          self.sample_width = sample_width  # 2 bytes for 16-bit
          self.audio_queue = queue.Queue()
          self.is_playing = False
          self.play_thread = None
          self.pyaudio_instance = None
          self.stream = None
          self._lock = threading.Lock()  # 添加锁来同步访问
          self._last_data_time = time.time()  # 记录最后接收数据的时间
          self._response_done = False  # 添加响应完成标志
          self._waiting_for_response = False # 标记是否正在等待服务器响应
          # 记录最后一次向音频流写入数据的时间及最近一次音频块的时长，用于更精确地判断播放结束
          self._last_play_time = time.time()
          self._last_chunk_duration = 0.0

      def start(self):
          """启动音频播放器"""
          with self._lock:
              if self.is_playing:
                  return

              self.is_playing = True

              try:
                  self.pyaudio_instance = pyaudio.PyAudio()

                  # 创建音频输出流
                  self.stream = self.pyaudio_instance.open(
                      format=pyaudio.paInt16,  # 16-bit
                      channels=self.channels,
                      rate=self.sample_rate,
                      output=True,
                      frames_per_buffer=1024
                  )

                  # 启动播放线程
                  self.play_thread = threading.Thread(target=self._play_audio)
                  self.play_thread.daemon = True
                  self.play_thread.start()

                  print("音频播放器已启动")
              except Exception as e:
                  print(f"启动音频播放器失败: {e}")
                  self._cleanup_resources()
                  raise

      def stop(self):
          """停止音频播放器"""
          with self._lock:
              if not self.is_playing:
                  return

              self.is_playing = False

          # 清空队列
          while not self.audio_queue.empty():
              try:
                  self.audio_queue.get_nowait()
              except queue.Empty:
                  break

          # 等待播放线程结束（在锁外面等待，避免死锁）
          if self.play_thread and self.play_thread.is_alive():
              self.play_thread.join(timeout=2.0)

          # 再次获取锁来清理资源
          with self._lock:
              self._cleanup_resources()

          print("音频播放器已停止")

      def _cleanup_resources(self):
          """清理音频资源（必须在锁内调用）"""
          try:
              # 关闭音频流
              if self.stream:
                  if not self.stream.is_stopped():
                      self.stream.stop_stream()
                  self.stream.close()
                  self.stream = None
          except Exception as e:
              print(f"关闭音频流时出错: {e}")

          try:
              if self.pyaudio_instance:
                  self.pyaudio_instance.terminate()
                  self.pyaudio_instance = None
          except Exception as e:
              print(f"终止PyAudio时出错: {e}")

      def add_audio_data(self, audio_data):
          """添加音频数据到播放队列"""
          if self.is_playing and audio_data:
              self.audio_queue.put(audio_data)
              with self._lock:
                  self._last_data_time = time.time()  # 更新最后接收数据的时间
                  self._waiting_for_response = False # 收到数据，不再等待

      def stop_receiving_data(self):
          """标记不再接收新的音频数据"""
          with self._lock:
              self._response_done = True
              self._waiting_for_response = False # 响应结束，不再等待

      def prepare_for_next_turn(self):
          """为下一轮对话重置播放器状态。"""
          with self._lock:
              self._response_done = False
              self._last_data_time = time.time()
              self._last_play_time = time.time()
              self._last_chunk_duration = 0.0
              self._waiting_for_response = True # 开始等待下一轮响应

          # 清空上一轮可能残留的音频数据
          while not self.audio_queue.empty():
              try:
                  self.audio_queue.get_nowait()
              except queue.Empty:
                  break

      def is_finished_playing(self):
          """检查是否已经播放完所有音频数据"""
          with self._lock:
              queue_size = self.audio_queue.qsize()
              time_since_last_data = time.time() - self._last_data_time
              time_since_last_play = time.time() - self._last_play_time

              # ---------------------- 智能结束判定 ----------------------
              # 1. 首选：如果服务器已标记完成且播放队列为空
              #    进一步等待最近一块音频播放完毕（音频块时长 + 0.1s 容错）。
              if self._response_done and queue_size == 0:
                  min_wait = max(self._last_chunk_duration + 0.1, 0.5)  # 至少等待 0.5s
                  if time_since_last_play >= min_wait:
                      return True

              # 2. 备用：如果长时间没有新数据且播放队列为空
              #    当服务器没有明确发出 `response.done` 时，此逻辑作为保障
              if not self._waiting_for_response and queue_size == 0 and time_since_last_data > 1.0:
                  print("\n(超时未收到新音频，判定播放结束)")
                  return True

              return False

      def _play_audio(self):
          """播放音频数据的工作线程"""
          while True:
              # 检查是否应该停止
              with self._lock:
                  if not self.is_playing:
                      break
                  stream_ref = self.stream  # 获取流的引用

              try:
                  # 从队列中获取音频数据，超时0.1秒
                  audio_data = self.audio_queue.get(timeout=0.1)

                  # 再次检查状态和流的有效性
                  with self._lock:
                      if self.is_playing and stream_ref and not stream_ref.is_stopped():
                          try:
                              # 播放音频数据
                              stream_ref.write(audio_data)
                              # 更新最近播放信息
                              self._last_play_time = time.time()
                              self._last_chunk_duration = len(audio_data) / (self.channels * self.sample_width) / self.sample_rate
                          except Exception as e:
                              print(f"写入音频流时出错: {e}")
                              break

                  # 标记该数据块已处理完成
                  self.audio_queue.task_done()

              except queue.Empty:
                  # 队列为空时继续等待
                  continue
              except Exception as e:
                  print(f"播放音频时出错: {e}")
                  break

  class MicrophoneRecorder:
      """实时麦克风录音器"""
      def __init__(self, sample_rate=16000, channels=1, chunk_size=3200):
          self.sample_rate = sample_rate
          self.channels = channels
          self.chunk_size = chunk_size
          self.pyaudio_instance = None
          self.stream = None
          self.frames = []
          self._is_recording = False
          self._record_thread = None

      def _recording_thread(self):
          """录音工作线程"""
          # 在 _is_recording 为 True 期间，持续从音频流中读取数据
          while self._is_recording:
              try:
                  # 使用 exception_on_overflow=False 避免因缓冲区溢出而崩溃
                  data = self.stream.read(self.chunk_size, exception_on_overflow=False)
                  self.frames.append(data)
              except (IOError, OSError) as e:
                  # 当流被关闭时，读取操作可能会引发错误
                  print(f"录音流读取错误，可能已关闭: {e}")
                  break

      def start(self):
          """开始录音"""
          if self._is_recording:
              print("录音已在进行中。")
              return

          self.frames = []
          self._is_recording = True

          try:
              self.pyaudio_instance = pyaudio.PyAudio()
              self.stream = self.pyaudio_instance.open(
                  format=pyaudio.paInt16,
                  channels=self.channels,
                  rate=self.sample_rate,
                  input=True,
                  frames_per_buffer=self.chunk_size
              )

              self._record_thread = threading.Thread(target=self._recording_thread)
              self._record_thread.daemon = True
              self._record_thread.start()
              print("麦克风录音已开始...")
          except Exception as e:
              print(f"启动麦克风失败: {e}")
              self._is_recording = False
              self._cleanup()
              raise

      def stop(self):
          """停止录音并返回音频数据"""
          if not self._is_recording:
              return None

          self._is_recording = False

          # 等待录音线程安全退出
          if self._record_thread:
              self._record_thread.join(timeout=1.0)

          self._cleanup()

          print("麦克风录音已停止。")
          return b''.join(self.frames)

      def _cleanup(self):
          """安全地清理 PyAudio 资源"""
          if self.stream:
              try:
                  if self.stream.is_active():
                      self.stream.stop_stream()
                  self.stream.close()
              except Exception as e:
                  print(f"关闭音频流时出错: {e}")

          if self.pyaudio_instance:
              try:
                  self.pyaudio_instance.terminate()
              except Exception as e:
                  print(f"终止 PyAudio 实例时出错: {e}")

          self.stream = None
          self.pyaudio_instance = None

  async def interactive_test():
      """
      交互式测试脚本：允许多轮连续对话，每轮可以发送音频和图片。
      """
      # ------------------- 1. 初始化和连接 (一次性) -------------------
      api_key = os.environ.get("DASHSCOPE_API_KEY")
      if not api_key:
          print("请设置DASHSCOPE_API_KEY环境变量")
          return

      print("--- 实时多轮音视频对话客户端 ---")
      print("正在初始化音频播放器和客户端...")

      audio_player = AudioPlayer()
      audio_player.start()

      def on_audio_received(audio_data):
          audio_player.add_audio_data(audio_data)

      def on_response_done(event):
          print("\n(收到响应结束标记)")
          audio_player.stop_receiving_data()

      realtime_client = OmniRealtimeClient(
          base_url="wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
          api_key=api_key,
          model="qwen3.5-omni-plus-realtime",
          voice="Ethan",
          instructions="你是个人助理小云，请你准确且友好地解答用户的问题，始终以乐于助人的态度回应。", # 设定模型角色
          on_text_delta=lambda text: print(f"助手回复: {text}", end="", flush=True),
          on_audio_delta=on_audio_received,
          turn_detection_mode=TurnDetectionMode.MANUAL,
          extra_event_handlers={"response.done": on_response_done}
      )

      message_handler_task = None
      try:
          await realtime_client.connect()
          print("已连接到服务器。输入 'q' 或 'quit' 可随时退出程序。")
          message_handler_task = asyncio.create_task(realtime_client.handle_messages())
          await asyncio.sleep(0.5)

          turn_counter = 1
          # ------------------- 2. 多轮对话循环 -------------------
          while True:
              print(f"\n--- 第 {turn_counter} 轮对话 ---")
              audio_player.prepare_for_next_turn()

              recorded_audio = None
              image_paths = []

              # --- 获取用户输入：从麦克风录音 ---
              loop = asyncio.get_event_loop()
              recorder = MicrophoneRecorder(sample_rate=16000) # 推荐使用16k采样率进行语音识别

              print("准备录音。按 Enter 键开始录音 (或输入 'q' 退出)...")
              user_input = await loop.run_in_executor(None, input)
              if user_input.strip().lower() in ['q', 'quit']:
                  print("用户请求退出...")
                  return

              try:
                  recorder.start()
              except Exception:
                  print("无法启动录音，请检查您的麦克风权限和设备。跳过本轮。")
                  continue

              print("录音中... 再次按 Enter 键停止录音。")
              await loop.run_in_executor(None, input)

              recorded_audio = recorder.stop()

              if not recorded_audio or len(recorded_audio) == 0:
                  print("未录制到有效音频，请重新开始本轮对话。")
                  continue

              # --- 获取图片输入 (可选) ---
              # 以下图片输入功能已被注释，暂时禁用。若需启用请取消下方代码注释。
              # print("\n请逐行输入【图片文件】的绝对路径 (可选)。完成后，输入 's' 或按 Enter 发送请求。")
              # while True:
              #     path = input("图片路径: ").strip()
              #     if path.lower() == 's' or path == '':
              #         break
              #     if path.lower() in ['q', 'quit']:
              #         print("用户请求退出...")
              #         return
              #   
              #     if not os.path.isabs(path):
              #         print("错误: 请输入绝对路径。")
              #         continue
              #     if not os.path.exists(path):
              #         print(f"错误: 文件不存在 -> {path}")
              #         continue
              #     image_paths.append(path)
              #     print(f"已添加图片: {os.path.basename(path)}")

              # --- 3. 发送数据并获取响应 ---
              print("\n--- 输入确认 ---")
              print(f"待处理音频: 1个 (来自麦克风), 图片: {len(image_paths)}个")
              print("------------------")

              # 3.1 发送录制的音频
              try:
                  print(f"发送麦克风录音 ({len(recorded_audio)}字节)")
                  await realtime_client.stream_audio(recorded_audio)
                  await asyncio.sleep(0.1)
              except Exception as e:
                  print(f"发送麦克风录音失败: {e}")
                  continue

              # 3.2 发送所有图片文件
              # 以下图片发送代码已被注释，暂时禁用。
              # for i, path in enumerate(image_paths):
              #     try:
              #         with open(path, "rb") as f:
              #             data = f.read()
              #         print(f"发送图片 {i+1}: {os.path.basename(path)} ({len(data)}字节)")
              #         await realtime_client.append_image(data)
              #         await asyncio.sleep(0.1)
              #     except Exception as e:
              #         print(f"发送图片 {os.path.basename(path)} 失败: {e}")

              # 3.3 提交并等待响应
              print("提交所有输入，请求服务器响应...")
              await realtime_client.commit_audio_buffer()
              await realtime_client.create_response()

              print("等待并播放服务器响应音频...")
              start_time = time.time()
              max_wait_time = 60
              while not audio_player.is_finished_playing():
                  if time.time() - start_time > max_wait_time:
                      print(f"\n等待超时 ({max_wait_time}秒), 进入下一轮。")
                      break
                  await asyncio.sleep(0.2)

              print("\n本轮音频播放完成！")
              turn_counter += 1

      except (asyncio.CancelledError, KeyboardInterrupt):
          print("\n程序被中断。")
      except Exception as e:
          print(f"发生未处理的错误: {e}")
      finally:
          # ------------------- 4. 清理资源 -------------------
          print("\n正在关闭连接并清理资源...")
          if message_handler_task and not message_handler_task.done():
              message_handler_task.cancel()

          if 'realtime_client' in locals() and realtime_client.ws and not realtime_client.ws.close:
              await realtime_client.close()
              print("连接已关闭。")

          audio_player.stop()
          print("程序退出。")

  if __name__ == "__main__":
      try:
          asyncio.run(interactive_test())
      except KeyboardInterrupt:
          print("\n程序被用户强制退出。") 
  ```

  运行 `manual_mode.py`，按 Enter 键开始说话，再按一次获取模型响应的音频。

## **交互流程**

## VAD 模式

将[session.update](https://help.aliyun.com/zh/model-studio/client-events#af43722339yva)事件的 `session.turn_detection` 设为 `"server_vad"`以启用 VAD 模式。此模式下，服务端自动检测语音起止并进行响应。适用于语音通话场景。

交互流程如下：

1. 服务端检测到语音开始，发送[input\_audio\_buffer.speech\_started](https://help.aliyun.com/zh/model-studio/server-events#b99f92d872n5c) 事件。
2. 客户端随时发送 [input\_audio\_buffer.append](https://help.aliyun.com/zh/model-studio/client-events#8d11313f2198k)与[input\_image\_buffer.append](https://help.aliyun.com/zh/model-studio/client-events#e27908854eaht) 事件追加音频与图片至缓冲区。

   > 发送 input\_image\_buffer.append 事件前，至少发送过一次 input\_audio\_buffer.append 事件。
   >
3. 服务端检测到语音结束，发送[input\_audio\_buffer.speech\_stopped](https://help.aliyun.com/zh/model-studio/server-events#fd08ffdf0a2mt) 事件。
4. 服务端发送[input\_audio\_buffer.committed](https://help.aliyun.com/zh/model-studio/server-events#bd9bfdc258afy) 事件提交音频缓冲区。
5. 服务端发送 [conversation.item.created](https://help.aliyun.com/zh/model-studio/server-events#bb4547ed5b5ht) 事件，包含从缓冲区创建的用户消息项。

| **生命周期** | **客户端事件**                                                                                                                                                                                                                      | **服务端事件**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 会话初始化         | [session.update](https://help.aliyun.com/zh/model-studio/client-events#af43722339yva) > 会话配置                                                                                                                                             | [session.created](https://help.aliyun.com/zh/model-studio/server-events#39689ed6e90ag) > 会话已创建 [session.updated](https://help.aliyun.com/zh/model-studio/server-events#424ef2e774q9p) > 会话配置已更新                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 用户音频输入       | [input\\_audio\\_buffer.append](https://help.aliyun.com/zh/model-studio/client-events#8d11313f2198k) > 添加音频到缓冲区 [input\\_image\\_buffer.append](https://help.aliyun.com/zh/model-studio/client-events#e27908854eaht) > 添加图片到缓冲区 | [input\\_audio\\_buffer.speech\\_started](https://help.aliyun.com/zh/model-studio/server-events#b99f92d872n5c) > 检测到语音开始 [input\\_audio\\_buffer.speech\\_stopped](https://help.aliyun.com/zh/model-studio/server-events#fd08ffdf0a2mt) > 检测到语音结束 [input\\_audio\\_buffer.committed](https://help.aliyun.com/zh/model-studio/server-events#bd9bfdc258afy) > 服务器收到提交的音频                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 服务器音频输出     | 无                                                                                                                                                                                                                                        | [response.created](https://help.aliyun.com/zh/model-studio/server-events#38033afc582r1) > 服务端开始生成响应 [response.output\\_item.added](https://help.aliyun.com/zh/model-studio/server-events#dae2260d40qtu) > 响应时有新的输出内容 [conversation.item.created](https://help.aliyun.com/zh/model-studio/server-events#bb4547ed5b5ht) > 对话项被创建 [response.content\\_part.added](https://help.aliyun.com/zh/model-studio/server-events#de7fa0b877j25) > 新的输出内容添加到assistant message [response.audio\\_transcript.delta](https://help.aliyun.com/zh/model-studio/server-events#35396453cfood) > 增量生成的转录文字 [response.audio.delta](https://help.aliyun.com/zh/model-studio/server-events#a25cc50a15car) > 模型增量生成的音频 [response.audio\\_transcript.done](https://help.aliyun.com/zh/model-studio/server-events#f4d1698567bsm) > 文本转录完成 [response.audio.done](https://help.aliyun.com/zh/model-studio/server-events#9e8eb59c67qnt) > 音频生成完成 [response.content\\_part.done](https://help.aliyun.com/zh/model-studio/server-events#011ad54242wft) > Assistant message 的文本或音频内容流式输出完成 [response.output\\_item.done](https://help.aliyun.com/zh/model-studio/server-events#f580421f45w3h) > Assistant message 的整个输出项流式传输完成 [response.done](https://help.aliyun.com/zh/model-studio/server-events#f2333c777d9s4) > 响应完成 |

## Manual 模式

将[session.update](https://help.aliyun.com/zh/model-studio/client-events#af43722339yva)事件的 `session.turn_detection` 设为 `null` 以启用 Manual 模式。此模式下，客户端通过显式发送 `input_audio_buffer.commit` 和 `response.create`事件请求服务器响应。适用于按下即说场景，如聊天软件中的发送语音。

交互流程如下：

1. 客户端随时发送 [input\_audio\_buffer.append](https://help.aliyun.com/zh/model-studio/client-events#8d11313f2198k)与[input\_image\_buffer.append](https://help.aliyun.com/zh/model-studio/client-events#e27908854eaht)事件追加音频与图片至缓冲区。

   > 发送 input\_image\_buffer.append 事件前，至少发送过一次 input\_audio\_buffer.append 事件。
   >
2. 客户端发送[input\_audio\_buffer.commit](https://help.aliyun.com/zh/model-studio/client-events#1cbea5fa7fkfl)事件提交音频缓冲区与图像缓冲区，告知服务端本轮的用户输入（音频及图片）已全部发送完毕。
3. 服务端响应 [input\_audio\_buffer.committed](https://help.aliyun.com/zh/model-studio/server-events#bd9bfdc258afy)事件。
4. 客户端发送[response.create](https://help.aliyun.com/zh/model-studio/client-events#a42f8e9111n72)事件，等待服务端返回模型的输出。
5. 服务端响应[conversation.item.created](https://help.aliyun.com/zh/model-studio/server-events#bb4547ed5b5ht)事件。

| **生命周期** | **客户端事件**                                                                                                                                                                                                                                                                                                                                                                                                                                                    | **服务端事件**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 会话初始化         | [session.update](https://help.aliyun.com/zh/model-studio/client-events#af43722339yva) > 会话配置                                                                                                                                                                                                                                                                                                                                                                           | [session.created](https://help.aliyun.com/zh/model-studio/server-events#39689ed6e90ag) > 会话已创建 [session.updated](https://help.aliyun.com/zh/model-studio/server-events#424ef2e774q9p) > 会话配置已更新                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 用户音频输入       | [input\\_audio\\_buffer.append](https://help.aliyun.com/zh/model-studio/client-events#8d11313f2198k) > 添加音频到缓冲区 [input\\_image\\_buffer.append](https://help.aliyun.com/zh/model-studio/client-events#e27908854eaht) > 添加图片到缓冲区 [input\\_audio\\_buffer.commit](https://help.aliyun.com/zh/model-studio/client-events#1cbea5fa7fkfl) > 提交音频与图片到服务器 [response.create](https://help.aliyun.com/zh/model-studio/client-events#a42f8e9111n72) > 创建模型响应 | [input\\_audio\\_buffer.committed](https://help.aliyun.com/zh/model-studio/server-events#bd9bfdc258afy) > 服务器收到提交的音频                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 服务器音频输出     | [input\\_audio\\_buffer.clear](https://help.aliyun.com/zh/model-studio/client-events#3b44f2f2abakw) > 清除缓冲区的音频                                                                                                                                                                                                                                                                                                                                                     | [response.created](https://help.aliyun.com/zh/model-studio/server-events#38033afc582r1) > 服务端开始生成响应 [response.output\\_item.added](https://help.aliyun.com/zh/model-studio/server-events#dae2260d40qtu) > 响应时有新的输出内容 [conversation.item.created](https://help.aliyun.com/zh/model-studio/server-events#bb4547ed5b5ht) > 对话项被创建 [response.content\\_part.added](https://help.aliyun.com/zh/model-studio/server-events#de7fa0b877j25) > 新的输出内容添加到assistant message 项 [response.audio\\_transcript.delta](https://help.aliyun.com/zh/model-studio/server-events#35396453cfood) > 增量生成的转录文字 [response.audio.delta](https://help.aliyun.com/zh/model-studio/server-events#a25cc50a15car) > 模型增量生成的音频 [response.audio\\_transcript.done](https://help.aliyun.com/zh/model-studio/server-events#f4d1698567bsm) > 完成文本转录 [response.audio.done](https://help.aliyun.com/zh/model-studio/server-events#9e8eb59c67qnt) > 完成音频生成 [response.content\\_part.done](https://help.aliyun.com/zh/model-studio/server-events#011ad54242wft) > Assistant message 的文本或音频内容流式输出完成 [response.output\\_item.done](https://help.aliyun.com/zh/model-studio/server-events#f580421f45w3h) > Assistant message 的整个输出项流式传输完成 [response.done](https://help.aliyun.com/zh/model-studio/server-events#f2333c777d9s4) > 响应完成 |

## **联网搜索**

联网搜索功能使模型能够基于实时检索数据进行回复，适用于股票价格、天气预报等需要即时信息的场景。模型可自主判断是否需要搜索来回应用户的即时问题。

> 联网搜索仅 `Qwen3.5-Omni-Realtime` 模型支持，且默认关闭，需通过 `session.update` 事件启用。

> 计费请参考[计费说明](https://help.aliyun.com/zh/model-studio/web-search#92ce83df3a599)中的 `agent`策略。

### **启用方式**

在 `session.update` 事件中添加以下参数：

- `enable_search`：设置为 `true` 启用联网搜索功能。
- `search_options.enable_source`：设置为 `true` 返回搜索结果来源列表。

参数详情请参见[session.update](https://help.aliyun.com/zh/model-studio/client-events#7692180895hvk)。

### **响应格式**

启用联网搜索后，`response.done` 事件中的 `usage` 会新增 `plugins` 字段，用于记录搜索计量信息：

```
{
    "usage": {
        "total_tokens": 2937,
        "input_tokens": 2554,
        "output_tokens": 383,
        "input_tokens_details": {
            "text_tokens": 2512,
            "audio_tokens": 42
        },
        "output_tokens_details": {
            "text_tokens": 90,
            "audio_tokens": 293
        },
        "plugins": {
            "search": {
                "count": 1,
                "strategy": "agent"
            }
        }
    }
}
```

### **代码示例**

以下示例展示如何在实时对话中启用联网搜索功能。

## DashScope Python SDK

在 `update_session` 调用中传入 `enable_search` 和 `search_options` 参数：

```
import os
import base64
import time
import json
import pyaudio
from dashscope.audio.qwen_omni import MultiModality, AudioFormat, OmniRealtimeCallback, OmniRealtimeConversation
import dashscope

dashscope.api_key = os.getenv('DASHSCOPE_API_KEY')
url = 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime'
model = 'qwen3.5-omni-plus-realtime'
voice = 'Tina'

class SearchCallback(OmniRealtimeCallback):
    def __init__(self, pya):
        self.pya = pya
        self.out = None
    def on_open(self):
        self.out = self.pya.open(format=pyaudio.paInt16, channels=1, rate=24000, output=True)
    def on_event(self, response):
        if response['type'] == 'response.audio.delta':
            self.out.write(base64.b64decode(response['delta']))
        elif response['type'] == 'conversation.item.input_audio_transcription.completed':
            print(f"[User] {response['transcript']}")
        elif response['type'] == 'response.audio_transcript.done':
            print(f"[LLM] {response['transcript']}")
        elif response['type'] == 'response.done':
            usage = response.get('response', {}).get('usage', {})
            plugins = usage.get('plugins', {})
            if plugins.get('search'):
                print(f"[Search] count={plugins['search']['count']}, strategy={plugins['search']['strategy']}")

pya = pyaudio.PyAudio()
callback = SearchCallback(pya)
conv = OmniRealtimeConversation(model=model, callback=callback, url=url)
conv.connect()
conv.update_session(
    output_modalities=[MultiModality.AUDIO, MultiModality.TEXT],
    voice=voice,
    instructions="你是个人助理小云",
    enable_search=True,
    search_options={'enable_source': True}
)
mic = pya.open(format=pyaudio.paInt16, channels=1, rate=16000, input=True)
print("联网搜索已启用，对着麦克风说话 (Ctrl+C 退出)...")
try:
    while True:
        audio_data = mic.read(3200, exception_on_overflow=False)
        conv.append_audio(base64.b64encode(audio_data).decode())
        time.sleep(0.01)
except KeyboardInterrupt:
    conv.close()
    mic.close()
    callback.out.close()
    pya.terminate()
    print("\n对话结束")
```

## DashScope Java SDK

在 `updateSession` 中通过 `parameters` 传入联网搜索配置：

```
import com.alibaba.dashscope.audio.omni.*;
import com.alibaba.dashscope.exception.NoApiKeyException;
import com.google.gson.JsonObject;
import javax.sound.sampled.*;
import java.nio.ByteBuffer;
import java.util.*;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.atomic.AtomicBoolean;

public class OmniSearch {
    static class SequentialAudioPlayer {
        private final SourceDataLine line;
        private final Queue<byte[]> audioQueue = new ConcurrentLinkedQueue<>();
        private final Thread playerThread;
        private final AtomicBoolean shouldStop = new AtomicBoolean(false);

        public SequentialAudioPlayer() throws LineUnavailableException {
            AudioFormat format = new AudioFormat(24000, 16, 1, true, false);
            line = AudioSystem.getSourceDataLine(format);
            line.open(format);
            line.start();
            playerThread = new Thread(() -> {
                while (!shouldStop.get()) {
                    byte[] audio = audioQueue.poll();
                    if (audio != null) {
                        line.write(audio, 0, audio.length);
                    } else {
                        try { Thread.sleep(10); } catch (InterruptedException ignored) {}
                    }
                }
            }, "AudioPlayer");
            playerThread.start();
        }

        public void play(String base64Audio) {
            audioQueue.add(Base64.getDecoder().decode(base64Audio));
        }
        public void close() {
            shouldStop.set(true);
            try { playerThread.join(1000); } catch (InterruptedException ignored) {}
            line.drain();
            line.close();
        }
    }

    public static void main(String[] args) {
        try {
            SequentialAudioPlayer player = new SequentialAudioPlayer();
            AtomicBoolean shouldStop = new AtomicBoolean(false);

            OmniRealtimeParam param = OmniRealtimeParam.builder()
                    .model("qwen3.5-omni-plus-realtime")
                    .apikey(System.getenv("DASHSCOPE_API_KEY"))
                    .url("wss://dashscope.aliyuncs.com/api-ws/v1/realtime")
                    .build();

            OmniRealtimeConversation conversation = new OmniRealtimeConversation(param, new OmniRealtimeCallback() {
                @Override public void onOpen() {
                    System.out.println("连接已建立");
                }
                @Override public void onClose(int code, String reason) {
                    System.out.println("连接已关闭");
                    shouldStop.set(true);
                }
                @Override public void onEvent(JsonObject event) {
                    String type = event.get("type").getAsString();
                    if ("response.audio.delta".equals(type)) {
                        player.play(event.get("delta").getAsString());
                    } else if ("response.audio_transcript.done".equals(type)) {
                        System.out.println("[LLM] " + event.get("transcript").getAsString());
                    } else if ("response.done".equals(type)) {
                        JsonObject response = event.getAsJsonObject("response");
                        if (response != null && response.has("usage")) {
                            JsonObject usage = response.getAsJsonObject("usage");
                            if (usage.has("plugins")) {
                                JsonObject plugins = usage.getAsJsonObject("plugins");
                                if (plugins.has("search")) {
                                    JsonObject search = plugins.getAsJsonObject("search");
                                    System.out.println("[Search] count=" + search.get("count").getAsInt()
                                            + ", strategy=" + search.get("strategy").getAsString());
                                }
                            }
                        }
                    }
                }
            });

            conversation.connect();
            conversation.updateSession(OmniRealtimeConfig.builder()
                    .modalities(Arrays.asList(OmniRealtimeModality.AUDIO, OmniRealtimeModality.TEXT))
                    .voice("Tina")
                    .enableTurnDetection(true)
                    .enableInputAudioTranscription(true)
                    .parameters(Map.of(
                            "instructions", "你是个人助理小云",
                            "enable_search", true,
                            "search_options", Map.of("enable_source", true)
                    ))
                    .build()
            );

            System.out.println("联网搜索已启用，请开始说话（按Ctrl+C退出）...");
            AudioFormat format = new AudioFormat(16000, 16, 1, true, false);
            TargetDataLine mic = AudioSystem.getTargetDataLine(format);
            mic.open(format);
            mic.start();

            ByteBuffer buffer = ByteBuffer.allocate(3200);
            while (!shouldStop.get()) {
                int bytesRead = mic.read(buffer.array(), 0, buffer.capacity());
                if (bytesRead > 0) {
                    conversation.appendAudio(Base64.getEncoder().encodeToString(buffer.array()));
                }
                Thread.sleep(20);
            }

            conversation.close(1000, "正常结束");
            player.close();
            mic.close();
        } catch (NoApiKeyException e) {
            System.err.println("未找到API KEY: 请设置环境变量 DASHSCOPE_API_KEY");
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
```

## WebSocket（Python）

在 `session.update` 的 JSON 中添加 `enable_search` 和 `search_options` 字段：

```
import json
import os
import websocket
import base64
import pyaudio
import threading

API_KEY = os.getenv("DASHSCOPE_API_KEY")
API_URL = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen3.5-omni-plus-realtime"

pya = pyaudio.PyAudio()
out_stream = pya.open(format=pyaudio.paInt16, channels=1, rate=24000, output=True)

def on_open(ws):
    ws.send(json.dumps({
        "type": "session.update",
        "session": {
            "modalities": ["text", "audio"],
            "voice": "Tina",
            "instructions": "你是个人助理小云",
            "input_audio_format": "pcm",
            "output_audio_format": "pcm",
            "enable_search": True,
            "search_options": {
                "enable_source": True
            }
        }
    }))
    print("联网搜索已启用，对着麦克风说话...")
    def send_audio():
        mic = pya.open(format=pyaudio.paInt16, channels=1, rate=16000, input=True)
        try:
            while True:
                audio = mic.read(3200, exception_on_overflow=False)
                ws.send(json.dumps({
                    "type": "input_audio_buffer.append",
                    "audio": base64.b64encode(audio).decode()
                }))
        except Exception:
            mic.close()
    threading.Thread(target=send_audio, daemon=True).start()

def on_message(ws, message):
    event = json.loads(message)
    if event["type"] == "response.audio.delta":
        out_stream.write(base64.b64decode(event["delta"]))
    elif event["type"] == "response.audio_transcript.done":
        print(f"[LLM] {event['transcript']}")
    elif event["type"] == "response.done":
        usage = event.get("response", {}).get("usage", {})
        plugins = usage.get("plugins", {})
        if plugins.get("search"):
            print(f"[Search] count={plugins['search']['count']}, strategy={plugins['search']['strategy']}")

def on_error(ws, error):
    print(f"Error: {error}")

headers = ["Authorization: Bearer " + API_KEY]
ws = websocket.WebSocketApp(API_URL, header=headers, on_open=on_open, on_message=on_message, on_error=on_error)
ws.run_forever()
```

## **API 参考**

- [客户端事件](https://help.aliyun.com/zh/model-studio/client-events)
- [服务端事件](https://help.aliyun.com/zh/model-studio/server-events)

## **计费与限流**

### **计费规则**

Qwen-Omni-Realtime 模型根据不同模态（音频、图像）对应的Token数计费。计费详情请参见百炼控制台。

**音频、图片转换为Token数的规则**

## 音频

- `Qwen3.5-Omni-Realtime：`

  - 输入音频计算公式：`总 Token 数 = 音频时长（单位：秒）* 7`
  - 输出音频计算公式：`总 Tokens 数 = 音频时长（单位：秒）* 12.5`
- `Qwen3-Omni-Flash-Realtime：`输入与输出音频的计算公式均为 `总 Token 数 = 音频时长（单位：秒）* 12.5`
- `Qwen-Omni-Turbo-Realtime：`输入与输出音频的计算公式均为 `总 Token 数 = 音频时长（单位：秒）* 25`

  若音频时长不足1秒，则按 1 秒计算。

## 图片

- `Qwen3.5-Omni-Plus-Realtime`模型**：**每 `32x32`像素对应 1 个 Token
- `Qwen3-Omni-Flash-Realtime`模型**：**每 `32x32`像素对应 1 个 Token
- `Qwen-Omni-Turbo-Realtime`模型：每 `28x28`像素对应 1 个 Token

一张图最少需要 4 个 Token，最多支持 1280 个 Token；可使用以下代码，传入图像路径和会话时长即可估算图片消耗的 Token 总量：

```
# 使用以下命令安装Pillow库：pip install Pillow
from PIL import Image
import math

# Qwen-Omni-Turbo-Realtime模型，缩放因子为28
# factor = 28
# Qwen3-Omni-Flash-Realtime、Qwen3.5-Omni-Realtime模型，缩放因子为32
factor = 32

def token_calculate(image_path='', duration=10):
    """
    :param image_path: 图像路径
    :param duration: 会话连接时长
    :return: 图像的Token数
    """
    if len(image_path) > 0:
        # 打开指定的PNG图片文件
        image = Image.open(image_path)
        # 获取图片的原始尺寸
        height = image.height
        width = image.width
        print(f"缩放前的图像尺寸为：高度为{height}，宽度为{width}")
        # 将高度调整为factor的整数倍
        h_bar = round(height / factor) * factor
        # 将宽度调整为factor的整数倍
        w_bar = round(width / factor) * factor
        # 图像的Token下限：4个Token
        min_pixels = factor * factor * 4
        # 图像的Token上限：1280个Token
        max_pixels = 1280 * factor * factor
        # 对图像进行缩放处理，调整像素的总数在范围[min_pixels,max_pixels]内
        if h_bar * w_bar > max_pixels:
            # 计算缩放因子beta，使得缩放后的图像总像素数不超过max_pixels
            beta = math.sqrt((height * width) / max_pixels)
            # 重新计算调整后的高度，确保为factor的整数倍
            h_bar = math.floor(height / beta / factor) * factor
            # 重新计算调整后的宽度，确保为factor的整数倍
            w_bar = math.floor(width / beta / factor) * factor
        elif h_bar * w_bar < min_pixels:
            # 计算缩放因子beta，使得缩放后的图像总像素数不低于min_pixels
            beta = math.sqrt(min_pixels / (height * width))
            # 重新计算调整后的高度，确保为factor的整数倍
            h_bar = math.ceil(height * beta / factor) * factor
            # 重新计算调整后的宽度，确保为factor的整数倍
            w_bar = math.ceil(width * beta / factor) * factor
        print(f"缩放后的图像尺寸为：高度为{h_bar}，宽度为{w_bar}")
        # 计算图像的Token数：总像素除以factor * factor
        token = int((h_bar * w_bar) / (factor * factor))
        print(f"缩放后的token数量为：{token}")
        total_token = token * math.ceil(duration / 2)
        print(f"总Token数为：{total_token}")
        return total_token
    else:
        print("错误：image_path参数为空，无法计算Token数")
        return 0

if __name__ == "__main__":
    total_token = token_calculate(image_path="xxx/test.jpg", duration=10)

```

### **限流**

模型限流规则请参见[限流](https://help.aliyun.com/zh/model-studio/rate-limit)。

## **常见问题**

### **如何在线体验 Qwen-Omni-Realtime 模型？**

A：您可以通过以下方式一键部署：

1. 访问[函数计算模板](https://fcnext.console.aliyun.com/applications/create?template=omni-realtime@dev)，**部署类型**选择**直接部署**，**百炼 API-KEY** 填入您的 API Key；单击**创建并部署默认环境**。
2. 等待约一分钟，在**环境详情**的**环境信息**中获取**访问域名**，**将访问域名的** `**http**`**改成** `**https**`（示例：https://omni-realtime.fcv3.xxxx.cn-hangzhou.fc.devsapp.net），修改后的 HTTPS 链接指向一个可在线体验的 Web 应用，可通过它与模型进行实时视频或语音通话。

**重要**

此链接使用自签名证书，仅用于临时测试。首次访问时，浏览器会显示安全警告，这是预期行为，**请勿在生产环境使用**。如需继续，请按浏览器提示操作（如点击“高级” → “继续前往（不安全）”）。

> 通过**资源信息**\-**函数资源**查看项目源代码。

> [函数计算](https://help.aliyun.com/zh/functioncompute/fc/product-overview/trial-quota-1)与[阿里云百炼](https://help.aliyun.com/zh/model-studio/new-free-quota)均为新用户提供免费额度，可以覆盖简单调试所需成本，额度耗尽后按量计费。只有在访问的情况下会产生费用。

### **怎么向模型输入图片？**

A：通过客户端发送[input\_image\_buffer.append](https://help.aliyun.com/zh/model-studio/client-events#c28ed38410nfw)事件。

- VAD 模式

  该模式会根据语音检测情况自动提交音频与图片，请在服务端响应[input\_audio\_buffer.speech\_stopped](https://help.aliyun.com/zh/model-studio/server-events#fd08ffdf0a2mt)前发送[input\_image\_buffer.append](https://help.aliyun.com/zh/model-studio/client-events#c28ed38410nfw)事件。
- Manual 模式

  参见[Manual 模式](#b3fed8b9161vd)代码，将图片输入与提交的两部分代码取消注释，即可传入本地图片。

若用于视频通话场景，可以对视频抽帧，建议以 1张/秒 的频率向服务端发送图像。[input\_image\_buffer.append](https://help.aliyun.com/zh/model-studio/client-events#c28ed38410nfw) 事件。 DashScope SDK 代码请参见[Omni-Realtime 示例代码](https://github.com/aliyun/alibabacloud-bailian-speech-demo/tree/master/samples/conversation/omni)。

## **错误码**

如果模型调用失败并返回报错信息，请参见[错误信息](https://help.aliyun.com/zh/model-studio/error-code)进行解决。

## **音色列表**

Qwen-Omni-Realtime模型的音色列表可参见[音色列表](https://help.aliyun.com/zh/model-studio/omni-voice-list)。

/\* 让引用上下间距调小，避免内容显示过于稀疏 \*/ .unionContainer .markdown-body blockquote { margin: 4px 0; } .aliyun-docs-content table.qwen blockquote { border-left: none; /\* 添加这一行来移除表格里的引用文字的左侧边框 \*/ padding-left: 5px; /\* 左侧内边距 \*/ margin: 4px 0; }
