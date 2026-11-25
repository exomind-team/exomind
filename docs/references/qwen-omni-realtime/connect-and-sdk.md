# 连接、模型选择与 SDK 示例

[返回《Qwen Omni Realtime · 接口参考资料》](../../Omni-runtime-qwen3.5-api.md)

Qwen-Omni-Realtime 是千问推出的实时音视频聊天模型。能同时理解流式的音频与图像输入（例如从视频流中实时抽取的连续图像帧），并实时输出高质量的文本与音频。

**支持的地域：**北京、新加坡，需使用各地域的 [API Key](https://help.aliyun.com/zh/model-studio/get-api-key)。

**在线体验：**请参见[如何在线体验 Qwen-Omni-Realtime 模型？](session-search-and-limits.md#14a119f447ehf)

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

  原生支持联网搜索（WebSearch），模型可自主判断是否需要搜索来回应即时问题。详见[联网搜索](session-search-and-limits.md#a8b2c3d4e5s6h)。
- **语义打断**

  自动识别对话意图，避免附和声和无意义背景音触发打断。
- **语音控制**

  通过语音指令控制声音大小、语速和情绪，如“语速快一些”、“声音大一些”、“用开心的语气”等。
- **支持的语言**

  支持 [113 种语种和方言](https://help.aliyun.com/zh/model-studio/qwen-omni#model-comparison-table)的语音识别，以及 [36 种语种和方言](https://help.aliyun.com/zh/model-studio/qwen-omni#model-comparison-table)的语音生成。
- **支持的音色**

  支持 55 种音色（47 种多语言 + 8 种方言），具体可查看[音色列表](session-search-and-limits.md#f4c9fd97f221z)。

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
