# 外部组合，而不是把全部功能搬回来

## WinCraft：只读当前状态

本桥接复用用户已安装的 WinCraft Python Client。候选未随包复制该 Client，也未验证最新宿主 API 的完整兼容。Python 3.11+；Client 自身依赖按 WinCraft 的 requirements 安装，仅可选桥接需要。

先创建 observer 文件：

```sh
node tools/client.mjs token --connection .local/rebuild/connection.runtime.json --role observer --name WinCraft --out .local/wincraft-observer.json
python integrations/wincraft/exomind_next.py --wincraft-python-dir /path/to/WinCraft/examples/python --runtime /private/wincraft.runtime.json --source .local/wincraft-observer.json
```

两份 JSON 是不同系统的私有描述符，不可交换。桥接来源只支持本机 HTTP 或验证证书的 HTTPS。只读状态包含协议、设备/空间、采样时间、快照游标和 active；不根据 HTTP404 推断空闲，不根据连接存在推断来源新鲜。

桥接显示值来自外心采样；来源失联后保留旧值并标记失败，不继续假装读到了新计时。它不调用开始/停止接口，不创建任务，不保存另一套业务计时器。WinCraft 的窗口/组件/租约/宿主重启能力由 Client 与 Host 承担，必须本地联调确认；不要把 Python 纯投影测试写成原生验收。

```sh
python -m unittest discover -s integrations/wincraft -p 'test_*.py' -v
```

## EasyTier：同一个协议换可达地址

先在原生 LAN 跑通完整同步，再把 advertised endpoint 换成 EasyTier 虚拟地址。设备身份、空间、操作 ID 和补齐代码不变。已有配对改地址调用 `/v1/peers/{id}/endpoint`，不能用删除配对替代改地址。

按同一组语料分别测试 LAN、EasyTier 直连、中继、切网、手机后台/前台。不仅测试 ping 或带宽；需回读对端 SQLite 层记录及附件哈希。同步时 UI 可关闭。记录入库 ACK 和页面渲染是不同测量点。

本候选不安装 EasyTier、不改变系统路由，也不继承系统 HTTP 代理。Android VPN 占用、后台进程和局域网发现需在目标设备重新验证。

## Obsidian：暂不自动写入 Vault

可移植导出是中立资料包，不是 Obsidian 插件。可以把其中 JSONL 作为后续导出器/人工整理的来源。第一轮不得自动把用户 Vault 作为同步真相源，也不覆盖人工编辑区。

后续明确 generated-region、外心来源 ID、投影版本、人工改动冲突和双向回写范围后，再实现窄导出器。本轮没有把这项“建议”冒充已完成集成。
