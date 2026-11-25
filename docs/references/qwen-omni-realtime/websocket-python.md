# Python WebSocket 示例

[返回《Qwen Omni Realtime · 接口参考资料》](../../Omni-runtime-qwen3.5-api.md)

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

<a id="b3fed8b9161vd"></a>

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
