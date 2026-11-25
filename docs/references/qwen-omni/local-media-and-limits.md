# 本地媒体、计费与常见问题

[返回《Qwen Omni · 多模态接口参考资料》](../../qwen3.5-omni-api.md)

<a id="c516d1e824x03"></a>

## **输入 Base64 编码的本地文件**

## 图片

以保存在本地的[eagle.png](https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20250326/nlgymo/eagle.png)为例。

Python

```
import os
from openai import OpenAI
import base64

client = OpenAI(
    # 若没有配置环境变量，请用阿里云百炼API Key将下行替换为：api_key="sk-xxx",
    # 新加坡和北京地域的API Key不同。获取API Key：https://help.aliyun.com/zh/model-studio/get-api-key
    api_key=os.getenv("DASHSCOPE_API_KEY"),
    # 以下是北京地域base_url，如果使用新加坡地域的模型，需要将base_url替换为：https://dashscope-intl.aliyuncs.com/compatible-mode/v1
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
)


#  Base64 编码格式
def encode_image(image_path):
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode("utf-8")


base64_image = encode_image("eagle.png")

completion = client.chat.completions.create(
    model="qwen3.5-omni-plus",# 模型为Qwen3-Omni-Flash时，请在非思考模式下运行
    messages=[
        {
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{base64_image}"},
                },
                {"type": "text", "text": "图中描绘的是什么景象？"},
            ],
        },
    ],
    # 设置输出数据的模态，当前支持两种：["text","audio"]、["text"]
    modalities=["text", "audio"],
    audio={"voice": "Tina", "format": "wav"},
    # stream 必须设置为 True，否则会报错
    stream=True,
    stream_options={"include_usage": True},
)

for chunk in completion:
    if chunk.choices:
        print(chunk.choices[0].delta)
    else:
        print(chunk.usage)
```

Node.js

```
import OpenAI from "openai";
import { readFileSync } from 'fs';

const openai = new OpenAI({
     // 若没有配置环境变量，请用阿里云百炼API Key将下行替换为：apiKey: "sk-xxx",
    // 新加坡和北京地域的API Key不同。获取API Key：https://help.aliyun.com/zh/model-studio/get-api-key
    apiKey: process.env.DASHSCOPE_API_KEY, 
    // 以下是北京地域base_url，如果使用新加坡地域的模型，需要将base_url替换为：https://dashscope-intl.aliyuncs.com/compatible-mode/v1
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1'
});

const encodeImage = (imagePath) => {
    const imageFile = readFileSync(imagePath);
    return imageFile.toString('base64');
};
const base64Image = encodeImage("eagle.png")

const completion = await openai.chat.completions.create({
    model: "qwen3.5-omni-plus",  // 模型为Qwen3-Omni-Flash时，请在非思考模式下运行
    messages: [
        {
            "role": "user",
            "content": [{
                "type": "image_url",
                "image_url": { "url": `data:image/png;base64,${base64Image}` },
            },
            { "type": "text", "text": "图中描绘的是什么景象？" }]
        }],
    stream: true,
    stream_options: {
        include_usage: true
    },
    modalities: ["text", "audio"],
    audio: { voice: "Tina", format: "wav" }
});

for await (const chunk of completion) {
    if (Array.isArray(chunk.choices) && chunk.choices.length > 0) {
        console.log(chunk.choices[0].delta);
    } else {
        console.log(chunk.usage);
    }
}
```

## 音频

以保存在本地的[welcome.mp3](https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20250214/pijhos/welcome.mp3)为例。

Python

```
import os
from openai import OpenAI
import base64
import numpy as np
import soundfile as sf
import requests

client = OpenAI(
    # 若没有配置环境变量，请用阿里云百炼API Key将下行替换为：api_key="sk-xxx",
    # 新加坡和北京地域的API Key不同。获取API Key：https://help.aliyun.com/zh/model-studio/get-api-key
    api_key=os.getenv("DASHSCOPE_API_KEY"),
    # 以下是北京地域base_url，如果使用新加坡地域的模型，需要将base_url替换为：https://dashscope-intl.aliyuncs.com/compatible-mode/v1
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
)


def encode_audio(audio_path):
    with open(audio_path, "rb") as audio_file:
        return base64.b64encode(audio_file.read()).decode("utf-8")


base64_audio = encode_audio("welcome.mp3")

completion = client.chat.completions.create(
    model="qwen3.5-omni-plus", # 模型为Qwen3-Omni-Flash时，请在非思考模式下运行
    messages=[
        {
            "role": "user",
            "content": [
                {
                    "type": "input_audio",
                    "input_audio": {
                        "data": f"data:;base64,{base64_audio}",
                        "format": "mp3",
                    },
                },
                {"type": "text", "text": "这段音频在说什么"},
            ],
        },
    ],
    # 设置输出数据的模态，当前支持两种：["text","audio"]、["text"]
    modalities=["text", "audio"],
    audio={"voice": "Tina", "format": "wav"},
    # stream 必须设置为 True，否则会报错
    stream=True,
    stream_options={"include_usage": True},
)

for chunk in completion:
    if chunk.choices:
        print(chunk.choices[0].delta)
    else:
        print(chunk.usage)
```

Node.js

```
import OpenAI from "openai";
import { readFileSync } from 'fs';

const openai = new OpenAI({
     // 若没有配置环境变量，请用阿里云百炼API Key将下行替换为：apiKey: "sk-xxx",
    // 新加坡和北京地域的API Key不同。获取API Key：https://help.aliyun.com/zh/model-studio/get-api-key
    apiKey: process.env.DASHSCOPE_API_KEY, 
    // 以下是北京地域base_url，如果使用新加坡地域的模型，需要将base_url替换为：https://dashscope-intl.aliyuncs.com/compatible-mode/v1
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1'
});

const encodeAudio = (audioPath) => {
    const audioFile = readFileSync(audioPath);
    return audioFile.toString('base64');
};
const base64Audio = encodeAudio("welcome.mp3")

const completion = await openai.chat.completions.create({
    model: "qwen3.5-omni-plus",  // 模型为Qwen3-Omni-Flash时，请在非思考模式下运行
    messages: [
        {
            "role": "user",
            "content": [{
                "type": "input_audio",
                "input_audio": { "data": `data:;base64,${base64Audio}`, "format": "mp3" },
            },
            { "type": "text", "text": "这段音频在说什么" }]
        }],
    stream: true,
    stream_options: {
        include_usage: true
    },
    modalities: ["text", "audio"],
    audio: { voice: "Tina", format: "wav" }
});

for await (const chunk of completion) {
    if (Array.isArray(chunk.choices) && chunk.choices.length > 0) {
        console.log(chunk.choices[0].delta);
    } else {
        console.log(chunk.usage);
    }
}
```

## 视频

## 视频文件

以保存在本地的[spring\_mountain.mp4](https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20250326/fqojlv/spring_mountain.mp4)为例。

Python

```
import os
from openai import OpenAI
import base64
import numpy as np
import soundfile as sf

client = OpenAI(
    # 若没有配置环境变量，请用阿里云百炼API Key将下行替换为：api_key="sk-xxx",
    api_key=os.getenv("DASHSCOPE_API_KEY"),
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
)


#  Base64 编码格式
def encode_video(video_path):
    with open(video_path, "rb") as video_file:
        return base64.b64encode(video_file.read()).decode("utf-8")


base64_video = encode_video("spring_mountain.mp4")

completion = client.chat.completions.create(
    model="qwen3.5-omni-plus", # 模型为Qwen3-Omni-Flash时，请在非思考模式下运行
    messages=[
        {
            "role": "user",
            "content": [
                {
                    "type": "video_url",
                    "video_url": {"url": f"data:;base64,{base64_video}"},
                },
                {"type": "text", "text": "她在唱什么"},
            ],
        },
    ],
    # 设置输出数据的模态，当前支持两种：["text","audio"]、["text"]
    modalities=["text", "audio"],
    audio={"voice": "Tina", "format": "wav"},
    # stream 必须设置为 True，否则会报错
    stream=True,
    stream_options={"include_usage": True},
)

for chunk in completion:
    if chunk.choices:
        print(chunk.choices[0].delta)
    else:
        print(chunk.usage)
```

Node.js

```
import OpenAI from "openai";
import { readFileSync } from 'fs';

const openai = new OpenAI(
    {
        // 若没有配置环境变量，请用阿里云百炼API Key将下行替换为：apiKey: "sk-xxx",
        apiKey: process.env.DASHSCOPE_API_KEY,
        baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
    }
);

const encodeVideo = (videoPath) => {
    const videoFile = readFileSync(videoPath);
    return videoFile.toString('base64');
};
const base64Video = encodeVideo("spring_mountain.mp4")

const completion = await openai.chat.completions.create({
    model: "qwen3.5-omni-plus",  // 模型为Qwen3-Omni-Flash时，请在非思考模式下运行
    messages: [
        {
            "role": "user",
            "content": [{
                "type": "video_url",
                "video_url": { "url": `data:;base64,${base64Video}` },
            },
            { "type": "text", "text": "她在唱什么" }]
        }],
    stream: true,
    stream_options: {
        include_usage: true
    },
    modalities: ["text", "audio"],
    audio: { voice: "Tina", format: "wav" }
});

for await (const chunk of completion) {
    if (Array.isArray(chunk.choices) && chunk.choices.length > 0) {
        console.log(chunk.choices[0].delta);
    } else {
        console.log(chunk.usage);
    }
}
```

## 图片列表

以保存在本地的[football1.jpg](https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20250319/vzfwkh/football1.jpg)、[football2.jpg](https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20250319/vgkgqy/football2.jpg)、[football3.jpg](https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20250127/fytnla/football3.jpg)与[football4.jpg](https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20250127/ygitwp/football4.jpg)为例。

Python

```
import os
from openai import OpenAI
import base64
import numpy as np
import soundfile as sf

client = OpenAI(
    # 若没有配置环境变量，请用阿里云百炼API Key将下行替换为：api_key="sk-xxx",
    # 新加坡和北京地域的API Key不同。获取API Key：https://help.aliyun.com/zh/model-studio/get-api-key
    api_key=os.getenv("DASHSCOPE_API_KEY"),
    # 以下是北京地域base_url，如果使用新加坡地域的模型，需要将base_url替换为：https://dashscope-intl.aliyuncs.com/compatible-mode/v1
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
)


#  Base64 编码格式
def encode_image(image_path):
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode("utf-8")


base64_image_1 = encode_image("football1.jpg")
base64_image_2 = encode_image("football2.jpg")
base64_image_3 = encode_image("football3.jpg")
base64_image_4 = encode_image("football4.jpg")

completion = client.chat.completions.create(
    model="qwen3.5-omni-plus",  # 模型为Qwen3-Omni-Flash时，请在非思考模式下运行
    messages=[
        {
            "role": "user",
            "content": [
                {
                    "type": "video",
                    "video": [
                        f"data:image/jpeg;base64,{base64_image_1}",
                        f"data:image/jpeg;base64,{base64_image_2}",
                        f"data:image/jpeg;base64,{base64_image_3}",
                        f"data:image/jpeg;base64,{base64_image_4}",
                    ],
                },
                {"type": "text", "text": "描述这个视频的具体过程"},
            ],
        }
    ],
    # 设置输出数据的模态，当前支持两种：["text","audio"]、["text"]
    modalities=["text", "audio"],
    audio={"voice": "Tina", "format": "wav"},
    # stream 必须设置为 True，否则会报错
    stream=True,
    stream_options={"include_usage": True},
)

for chunk in completion:
    if chunk.choices:
        print(chunk.choices[0].delta)
    else:
        print(chunk.usage)
```

Node.js

```
import OpenAI from "openai";
import { readFileSync } from 'fs';

const openai = new OpenAI({
     // 若没有配置环境变量，请用阿里云百炼API Key将下行替换为：apiKey: "sk-xxx",
    // 新加坡和北京地域的API Key不同。获取API Key：https://help.aliyun.com/zh/model-studio/get-api-key
    apiKey: process.env.DASHSCOPE_API_KEY, 
    // 以下是北京地域base_url，如果使用新加坡地域的模型，需要将base_url替换为：https://dashscope-intl.aliyuncs.com/compatible-mode/v1
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1'
});

const encodeImage = (imagePath) => {
    const imageFile = readFileSync(imagePath);
    return imageFile.toString('base64');
  };
const base64Image1 = encodeImage("football1.jpg")
const base64Image2 = encodeImage("football2.jpg")
const base64Image3 = encodeImage("football3.jpg")
const base64Image4 = encodeImage("football4.jpg")

const completion = await openai.chat.completions.create({
    model: "qwen3.5-omni-plus",  // 模型为Qwen3-Omni-Flash时，请在非思考模式下运行
    messages: [{
        role: "user",
        content: [
            {
                type: "video",
                video: [
                    `data:image/jpeg;base64,${base64Image1}`,
                    `data:image/jpeg;base64,${base64Image2}`,
                    `data:image/jpeg;base64,${base64Image3}`,
                    `data:image/jpeg;base64,${base64Image4}`
                ]
            },
            {
                type: "text",
                text: "描述这个视频的具体过程"
            }
        ]
    }],
    stream: true,
    stream_options: {
        include_usage: true
    },
    modalities: ["text", "audio"],
    audio: { voice: "Tina", format: "wav" }
});

for await (const chunk of completion) {
    if (Array.isArray(chunk.choices) && chunk.choices.length > 0) {
        console.log(chunk.choices[0].delta);
    } else {
        console.log(chunk.usage);
    }
}
```

## API参考

关于千问Omni 模型的输入输出参数，请参见[OpenAI Chat](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)。

## 计费与限流

**计费规则**

Qwen-Omni模型根据不同模态（音频、图像、视频）对应的Token数计费。计费详情请参见百炼控制台。

**音频、图片与视频转换为Token数的规则**

## 音频

- `Qwen3.5-Omni`：

  - 输入音频计算公式：`总 Tokens 数 = 音频时长（单位：秒）* 7`
  - 输出音频计算公式：`总 Tokens 数 = 音频时长（单位：秒）* 12.5`
- `Qwen3-Omni-Flash：输入与输出音频的计算公式均为总 Tokens 数 = 音频时长（单位：秒）* 12.5`
- `Qwen-Omni-Turbo：输入与输出音频的计算公式均为总 Tokens 数 = 音频时长（单位：秒）* 25`

若音频时长不足1秒，则按 1 秒计算。

## 图片

- `Qwen3.5-Omni`、`Qwen3-Omni-Flash`模型**：**每 `32x32`像素对应 1 个 Token
- `Qwen-Omni-Turbo`模型：每 `28x28`像素对应 1 个 Token

一张图最少需要 4 个 Token，最多支持 1280 个 Token；可使用以下代码，传入图像路径即可估算单张图片消耗的 Token 总量：

```
import math
# 使用以下命令安装Pillow库：pip install Pillow
from PIL import Image

# Qwen-Omni-Turbo模型，factor为28
# factor = 28
# Qwen3.5-Omni、Qwen3-Omni-Flash模型，factor为32
factor = 32

def token_calculate(image_path=''):
    """
    param image_path: 图像路径
    return: 单张图像的Token数
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
        min_pixels = 4 * factor * factor
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
        token = int((h_bar * w_bar) / (factor * factor)) + 2
        print(f"缩放后的token数量为：{token}")
        return token
    else:
        raise ValueError("图像路径不能为空，请提供有效的图像文件路径")
  
if __name__ == "__main__":
    token = token_calculate(image_path="xxx/test.jpg")
```

## 视频

视频文件的 Token 分为 `video_tokens`（视觉）与 `audio_tokens`（音频）。

- `video_tokens`

  计算过程较为复杂。请参见以下代码：

  ```
  # 使用前安装：pip install opencv-python
  import math
  import os
  import logging
  import cv2

  # 固定参数
  FRAME_FACTOR = 2

  # Qwen3-Omni-Flash模型，IMAGE_FACTOR为32
  IMAGE_FACTOR = 32

  # Qwen-Omni-Turbo模型，IMAGE_FACTOR为28
  # IMAGE_FACTOR = 28

  # 视频帧的长宽比
  MAX_RATIO = 200

  # 视频帧的像素下限，Qwen3-Omni-Flash为：128 * 32 * 32
  VIDEO_MIN_PIXELS = 128 * 32 * 32
  # Qwen-Omni-Turbo
  # VIDEO_MIN_PIXELS = 128 * 28 * 28

  # 视频帧的像素上限，Qwen3-Omni-Flash为：768 * 32 * 32
  VIDEO_MAX_PIXELS = 768 * 32 * 32
  # Qwen-Omni-Turbo：
  # VIDEO_MAX_PIXELS = 768 * 28 * 28

  FPS = 2
  # 最少抽取帧数
  FPS_MIN_FRAMES = 4

  # 最大抽取帧数
  # Qwen3-Omni-Flash模型的大抽取帧数：128
  # Qwen3-Omni-Turbo模型的大抽取帧数：80
  FPS_MAX_FRAMES = 128

  # 视频输入的最大像素值，Qwen3-Omni-Flash为 16384 * 32 * 32；
  VIDEO_TOTAL_PIXELS = 16384 * 32 * 32
  # Qwen-Omni-Turbo：
  # VIDEO_TOTAL_PIXELS = 16384 * 28 * 28

  def round_by_factor(number, factor):
      return round(number / factor) * factor

  def ceil_by_factor(number, factor):
      return math.ceil(number / factor) * factor

  def floor_by_factor(number, factor):
      return math.floor(number / factor) * factor

  def get_video(video_path):
      cap = cv2.VideoCapture(video_path)
      frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
      frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
      total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
      video_fps = cap.get(cv2.CAP_PROP_FPS)
      cap.release()
      return frame_height, frame_width, total_frames, video_fps

  def smart_nframes(total_frames, video_fps):
      min_frames = ceil_by_factor(FPS_MIN_FRAMES, FRAME_FACTOR)
      max_frames = floor_by_factor(min(FPS_MAX_FRAMES, total_frames), FRAME_FACTOR)
      duration = total_frames / video_fps if video_fps != 0 else 0
      if duration - int(duration) > (1 / FPS):
          total_frames = math.ceil(duration * video_fps)
      else:
          total_frames = math.ceil(int(duration) * video_fps)
      nframes = total_frames / video_fps * FPS
      nframes = int(min(min(max(nframes, min_frames), max_frames), total_frames))
      if not (FRAME_FACTOR <= nframes <= total_frames):
          raise ValueError(f"nframes should in interval [{FRAME_FACTOR}, {total_frames}], but got {nframes}.")
      return nframes

  def smart_resize(height, width, nframes, factor=IMAGE_FACTOR):
      min_pixels = VIDEO_MIN_PIXELS
      total_pixels = VIDEO_TOTAL_PIXELS
      max_pixels = max(min(VIDEO_MAX_PIXELS, total_pixels / nframes * FRAME_FACTOR), int(min_pixels * 1.05))
      if max(height, width) / min(height, width) > MAX_RATIO:
          raise ValueError(f"absolute aspect ratio must be smaller than {MAX_RATIO}, got {max(height, width) / min(height, width)}")
      h_bar = max(factor, round_by_factor(height, factor))
      w_bar = max(factor, round_by_factor(width, factor))
      if h_bar * w_bar > max_pixels:
          beta = math.sqrt((height * width) / max_pixels)
          h_bar = floor_by_factor(height / beta, factor)
          w_bar = floor_by_factor(width / beta, factor)
      elif h_bar * w_bar < min_pixels:
          beta = math.sqrt(min_pixels / (height * width))
          h_bar = ceil_by_factor(height * beta, factor)
          w_bar = ceil_by_factor(width * beta, factor)
      return h_bar, w_bar

  def video_token_calculate(video_path):
      height, width, total_frames, video_fps = get_video(video_path)
      nframes = smart_nframes(total_frames, video_fps)
      resized_height, resized_width = smart_resize(height, width, nframes)
      video_token = int(math.ceil(nframes / FPS) * resized_height / 32 * resized_width / 32)
      video_token += 2  # 视觉标记
      return video_token

  if __name__ == "__main__":
      video_path = "spring_mountain.mp4"  # 你的视频路径
      video_token = video_token_calculate(video_path)
      print("video_tokens:", video_token)
  ```
- `audio_tokens`

  - `Qwen3.5-Omni`：

    - 输入音频计算公式：`总 Tokens 数 = 音频时长（单位：秒）* 7`
    - 输出音频计算公式：`总 Tokens 数 = 音频时长（单位：秒）* 12.5`
  - `Qwen3-Omni-Flash：输入与输出音频的计算公式均为总 Tokens 数 = 音频时长（单位：秒）* 12.5`
  - `Qwen-Omni-Turbo：输入与输出音频的计算公式均为总 Tokens 数 = 音频时长（单位：秒）* 25`

  若音频时长不足1秒，则按 1 秒计算。

**免费额度**

关于免费额度的领取、查询、使用方法等详情，请参见[新人免费额度](https://help.aliyun.com/zh/model-studio/new-free-quota)。

**限流**

模型限流规则及常见问题，请参见[限流](https://help.aliyun.com/zh/model-studio/rate-limit)。

## **常见问题**

### **Q：如何给 Qwen-Omni-Turbo 模型设置角色？**

A：Qwen-Omni-Turbo模型在输出模态包括音频时**不支持设定 System Message，**即使您在 System Message 中说明：“你是XXX...”等角色信息，Qwen-Omni 的自我认知依然会是千问。

- **方法1（推荐）：**Qwen3-Omni-Flash模型已支持设定**System Message，**建议切换至该系列模型。
- **方法2：**在messages 数组的开头手动添加用于角色设定的 User Message 和 Assistant Message，达到给 Qwen-Omni 模型设置角色的效果。

  **用于角色设定的示例代码**

  ## OpenAI 兼容

  Python


  ```
  import os
  from openai import OpenAI

  client = OpenAI(
      # 若没有配置环境变量，请用阿里云百炼API Key将下行替换为：api_key="sk-xxx",
      api_key=os.getenv("DASHSCOPE_API_KEY"),
      base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
  )

  completion = client.chat.completions.create(
      model="qwen-omni-turbo",
      messages=[
          {"role": "user", "content": "你是一个商场的导购员，你负责的商品有手机、电脑、冰箱"},
          {"role": "assistant", "content": "好的，我记住了你的设定。"},
          {"role": "user", "content": "你是谁"},
      ],
      # 设置输出数据的模态，当前支持两种：["text","audio"]、["text"]
      modalities=["text", "audio"],
      audio={"voice": "Tina", "format": "wav"},
      # stream 必须设置为 True，否则会报错
      stream=True,
      stream_options={"include_usage": True},
  )

  for chunk in completion:
      if chunk.choices:
          print(chunk.choices[0].delta)
      else:
          print(chunk.usage)
  ```

  Node.js

  ```
  import OpenAI from "openai";

  const openai = new OpenAI(
      {
          // 若没有配置环境变量，请用阿里云百炼API Key将下行替换为：apiKey: "sk-xxx",
          apiKey: process.env.DASHSCOPE_API_KEY,
          baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
      }
  );
  const completion = await openai.chat.completions.create({
      model: "qwen-omni-turbo",
      messages: [
          { role: "user", content: "你是一个商场的导购员，你负责的商品有手机、电脑、冰箱" },
          { role: "assistant", content: "好的，我记住了你的设定。" },
          { role: "user", content: "你是谁？" }
      ],
      stream: true,
      stream_options: {
          include_usage: true
      },
      modalities: ["text", "audio"],
      audio: { voice: "Tina", format: "wav" }
  });

  for await (const chunk of completion) {
      if (Array.isArray(chunk.choices) && chunk.choices.length > 0) {
          console.log(chunk.choices[0].delta);
      } else {
          console.log(chunk.usage);
      }
  }
  ```

  curl

  ```
  curl -X POST https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
      "model": "qwen-omni-turbo",
      "messages": [
          {
              "role": "user", 
              "content": "你是一个商场的导购员，你负责的商品有手机、电脑、冰箱"
          },
          {
              "role": "assistant", 
              "content": "好的，我记住了你的设定。"
          },
          {
              "role": "user", 
              "content": "你是谁？"
          }
      ],
      "stream":true,
      "stream_options":{
          "include_usage":true
      },
      "modalities":["text","audio"],
      "audio":{"voice":"Tina","format":"wav"}
  }'
  ```

## 错误码

如果模型调用失败并返回报错信息，请参见[错误信息](https://help.aliyun.com/zh/model-studio/error-code)进行解决。

## **音色列表**

Qwen-Omni模型的音色列表可参见[音色列表](https://help.aliyun.com/zh/model-studio/omni-voice-list)。

/\* 让引用上下间距调小，避免内容显示过于稀疏 \*/ .unionContainer .markdown-body blockquote { margin: 4px 0; } .aliyun-docs-content table.qwen blockquote { border-left: none; /\* 添加这一行来移除表格里的引用文字的左侧边框 \*/ padding-left: 5px; /\* 左侧内边距 \*/ margin: 4px 0; }
