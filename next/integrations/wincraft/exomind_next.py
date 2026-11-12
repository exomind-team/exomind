'''将新外心的只读当前状态投影到既有 WinCraft Client。

- 复用 WinCraft 的连接、窗口和租约客户端，不复制一份宿主实现。
- 仅访问 /v1/views/current；不创建外心任务，不改变时间块。
- 原生 WinCraft 联调属于本地验收，本模块的投影测试不代表原生窗口已通过。
'''
from __future__ import annotations

import argparse
import asyncio
import json
import ssl
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

# Agent 生成的桥接候选；尚未经维护者人工接管验收。
PROTOCOL: str = 'exomind-buffer/1'
HTTP_TIMEOUT: float = 4.0
RESPONSE_LIMIT: int = 128 * 1024
POLL_SECONDS: float = 2.0


@dataclass(frozen=True)
class Source:
    '''明确选择的只读外心来源。'''
    url: str
    token: str
    ca: str | None = None

    @classmethod
    def from_file(cls, path: Path) -> Source:
        '''从私有 observer 连接文件读取，不猜测旧 Runtime 端口或档案。'''
        value = json.loads(path.read_text(encoding='utf-8'))
        if value.get('protocol') != PROTOCOL or value.get('role') != 'observer':
            raise ValueError('需要新外心协议的 observer 连接文件，不能使用 owner 文件')
        url = value.get('url')
        token = value.get('token')
        if not isinstance(url, str) or not isinstance(token, str) or not token:
            raise ValueError('连接地址或只读令牌缺失')
        parsed = urlparse(url)
        if parsed.scheme not in ('http', 'https') or parsed.username or parsed.password:
            raise ValueError('来源必须是无内嵌凭据的 HTTP(S) 地址')
        if parsed.scheme == 'http' and parsed.hostname not in ('127.0.0.1', 'localhost', '::1'):
            raise ValueError('远程来源需要 HTTPS，或通过本机隧道访问')
        ca = value.get('ca')
        if ca is not None and not isinstance(ca, str):
            raise ValueError('CA 证书必须为 PEM 文本')
        return cls(url=url.rstrip('/'), token=token, ca=ca)


def project_snapshot(value: object) -> dict[str, object]:
    '''验证真实来源，再生成只读投影；错误不折叠为空闲。'''
    if not isinstance(value, dict) or value.get('protocol') != PROTOCOL:
        raise ValueError('当前状态协议不匹配')
    active = value.get('active')
    observed = value.get('observedAt')
    if not isinstance(active, list) or not isinstance(observed, int):
        raise ValueError('当前状态缺少 active 或 observedAt')
    items: list[dict[str, str]] = []
    for block in active:
        if not isinstance(block, dict) or not isinstance(block.get('name'), str):
            raise ValueError('时间块对象无效')
        started = block.get('startedAt')
        if not isinstance(started, int) or block.get('state') != 'running':
            raise ValueError('来源未提供有效的进行中状态')
        # 仅按来源采样时间投影；来源断开后不继续伪装计时推进。
        elapsed = max(0, (observed - started) // 1000)
        duration = f'{elapsed // 3600:02}:{elapsed // 60 % 60:02}:{elapsed % 60:02}'
        items.append({'key': block['name'], 'value': duration})
    if not items:
        items.append({'key': '当前', 'value': '没有进行中的时间块'})
    return {
        'status': '发现并发时间块，请在外心处理' if len(active) > 1 else '外心状态已读取',
        'items': items,
        'sampled': datetime.fromtimestamp(observed / 1000).strftime('%H:%M:%S'),
    }


def poll(source: Source) -> dict[str, object]:
    '''读取固定的状态接口，保留 HTTP 与格式错误。'''
    request = Request(
        source.url + '/v1/views/current',
        headers={'Authorization': f'Bearer {source.token}', 'Accept': 'application/json'},
    )
    context = ssl.create_default_context(cadata=source.ca)
    with urlopen(request, timeout=HTTP_TIMEOUT, context=context) as response:
        raw = response.read(RESPONSE_LIMIT + 1)
    if len(raw) > RESPONSE_LIMIT:
        raise ValueError('当前状态超过桥接响应上限')
    return project_snapshot(json.loads(raw))


def scene_node(node_id: str, kind: str, props: dict[str, object],
               children: list[dict[str, object]] | None = None) -> dict[str, object]:
    '''构造 WinCraft 声明式节点，不发送 HTML 或可执行脚本。'''
    return {'id': node_id, 'kind': kind, 'props': props, 'children': children or []}


async def run(args: argparse.Namespace) -> None:
    '''在用户显式指定的 WinCraft 客户端上运行只读提供者。'''
    client_directory = Path(args.wincraft_python_dir).resolve(strict=True)
    if not (client_directory / 'client.py').is_file():
        raise ValueError('目录中没有 WinCraft client.py')
    # 这是脚本自身的组合边界，加载用户指定、受信任的本机 WinCraft 源码。
    sys.path.insert(0, str(client_directory))
    from client import Client

    source = Source.from_file(Path(args.source))
    async with Client(args.runtime, 'exomind.next.readonly', None) as client:
        created = await client.call('world.create', {
            'window': {'title': '外心 · 此刻', 'width': 360, 'height': 240},
        })
        world_id, lease = created['world']['id'], created['lease']
        last: dict[str, object] = {'status': '尚未读取', 'items': [], 'sampled': '未知'}
        scene = {
            'root': scene_node('root', 'stack', {'gap': 12}, [
                scene_node('title', 'text', {'text': '此刻', 'size': 'title'}),
                scene_node('status', 'badge', {'text': {'$path': '/status'}}),
                scene_node('blocks', 'key_value', {'items': {'$path': '/items'}}),
                scene_node('sample', 'text', {'text': {'$path': '/sampled'}, 'tone': 'muted'}),
            ]),
            'data': last,
        }
        await client.mutate('scene.replace', world_id, lease, scene=scene)
        while True:
            try:
                last = await asyncio.to_thread(poll, source)
            except (OSError, ValueError) as error:
                last = {**last, 'status': f'来源读取失败，旧状态保留：{type(error).__name__}'}
            await client.mutate('data.replace', world_id, lease, data=last)
            await asyncio.sleep(POLL_SECONDS)


def main() -> None:
    '''显式指定两个系统的私有连接，不扫描机器寻找凭据。'''
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--wincraft-python-dir', required=True)
    parser.add_argument('--runtime', required=True, help='WinCraft 私有 runtime.json')
    parser.add_argument('--source', required=True, help='外心 observer 私有连接文件')
    args = parser.parse_args()
    try:
        asyncio.run(run(args))
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
