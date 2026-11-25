# 会话、联网搜索、限额与常见问题

[返回《Qwen Omni Realtime · 接口参考资料》](../../Omni-runtime-qwen3.5-api.md)

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

<a id="a8b2c3d4e5s6h"></a>

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

<a id="14a119f447ehf"></a>

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

  参见[Manual 模式](websocket-python.md#b3fed8b9161vd)代码，将图片输入与提交的两部分代码取消注释，即可传入本地图片。

若用于视频通话场景，可以对视频抽帧，建议以 1张/秒 的频率向服务端发送图像。[input\_image\_buffer.append](https://help.aliyun.com/zh/model-studio/client-events#c28ed38410nfw) 事件。 DashScope SDK 代码请参见[Omni-Realtime 示例代码](https://github.com/aliyun/alibabacloud-bailian-speech-demo/tree/master/samples/conversation/omni)。

## **错误码**

如果模型调用失败并返回报错信息，请参见[错误信息](https://help.aliyun.com/zh/model-studio/error-code)进行解决。

<a id="f4c9fd97f221z"></a>

## **音色列表**

Qwen-Omni-Realtime模型的音色列表可参见[音色列表](https://help.aliyun.com/zh/model-studio/omni-voice-list)。

/\* 让引用上下间距调小，避免内容显示过于稀疏 \*/ .unionContainer .markdown-body blockquote { margin: 4px 0; } .aliyun-docs-content table.qwen blockquote { border-left: none; /\* 添加这一行来移除表格里的引用文字的左侧边框 \*/ padding-left: 5px; /\* 左侧内边距 \*/ margin: 4px 0; }
