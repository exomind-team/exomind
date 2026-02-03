# Ralph Loop 增强版实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标：** 构建一个功能完整的 Ralph Loop 增强版，支持外部状态存储、中间件机制、自定义终止条件、并行运行和可视化监控。

**架构：** 采用插件化架构，核心引擎保持轻量，所有增强功能通过可插拔模块实现。状态管理支持本地文件（默认）和 Redis（可选），中间件采用事件驱动模式，可视化采用轻量 Web 服务器。

**技术栈：**
- 状态存储：JSON 文件 + 可选 Redis
- Web 服务器：Python Flask / FastAPI
- 中间件：Python 插件机制 (entrypoints)
- 前端：Vue 3 + Vite
- 测试：pytest

---

## 第一阶段：核心架构与状态存储

### Task 1: 创建增强版状态存储模块

**文件：**
- 创建: `ralph-loop-enhanced/state/storage.py`
- 创建: `ralph-loop-enhanced/state/__init__.py`
- 测试: `tests/test_state_storage.py`

**Step 1: 编写失败的测试**

```python
# tests/test_state_storage.py
import pytest
from ralph_loop_enhanced.state.storage import StateStorage, StorageBackend

def test_local_storage_basic_operations():
    storage = StateStorage(backend_type="local", base_path="/tmp/ralph-test")

    state_id = "test-loop-1"
    initial_state = {"iteration": 1, "max_iterations": 10, "prompt": "test task"}

    # 创建状态
    storage.create(state_id, initial_state)

    # 读取状态
    loaded = storage.get(state_id)
    assert loaded["iteration"] == 1
    assert loaded["prompt"] == "test task"

    # 更新迭代
    storage.update(state_id, iteration=2)
    updated = storage.get(state_id)
    assert updated["iteration"] == 2

    # 删除状态
    storage.delete(state_id)
    assert storage.get(state_id) is None

def test_state_locking():
    storage = StateStorage(backend_type="local", base_path="/tmp/ralph-test")

    state_id = "locked-loop"
    storage.create(state_id, {"iteration": 1})

    # 获取锁
    lock = storage.acquire_lock(state_id)
    assert lock is True

    # 再次获取应该失败
    lock2 = storage.acquire_lock(state_id)
    assert lock2 is False

    # 释放锁
    storage.release_lock(state_id)
    lock3 = storage.acquire_lock(state_id)
    assert lock3 is True
```

**Step 2: 运行测试验证失败**

```bash
cd /home/hailay/Project/exomind
pytest tests/test_state_storage.py -v
Expected: FAIL - ModuleNotFoundError: No module named 'ralph_loop_enhanced'
```

**Step 3: 实现最小代码**

```python
# ralph-loop-enhanced/state/storage.py
import json
import os
import time
import fcntl
from pathlib import Path
from typing import Dict, Any, Optional, Literal
from dataclasses import dataclass, asdict
from enum import Enum

class StorageBackend(Enum):
    LOCAL = "local"
    REDIS = "redis"

@dataclass
class RalphState:
    iteration: int
    max_iterations: int
    prompt: str
    completion_promise: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    def __post_init__(self):
        from datetime import datetime
        now = datetime.now().isoformat()
        if not self.created_at:
            self.created_at = now
        self.updated_at = now

class StateStorage:
    """Ralph Loop 状态存储，支持本地文件和 Redis"""

    def __init__(
        self,
        backend_type: Literal["local", "redis"] = "local",
        base_path: str = ".claude/ralph-states",
        redis_url: Optional[str] = None,
        ttl: int = 3600
    ):
        self.backend_type = backend_type
        self.base_path = Path(base_path)
        self.redis_url = redis_url
        self.ttl = ttl

        if backend_type == "local":
            self.base_path.mkdir(parents=True, exist_ok=True)
        elif backend_type == "redis":
            self._init_redis()

    def _init_redis(self):
        try:
            import redis
            self._redis_client = redis.from_url(self.redis_url) if self.redis_url else redis.Redis()
        except ImportError:
            raise ImportError("Redis backend requires 'redis' package. Install with: pip install redis")

    def _get_state_path(self, state_id: str) -> Path:
        return self.base_path / f"{state_id}.json"

    def create(self, state_id: str, state: Dict[str, Any]) -> RalphState:
        """创建新状态"""
        ralph_state = RalphState(
            iteration=state.get("iteration", 1),
            max_iterations=state.get("max_iterations", 0),
            prompt=state.get("prompt", ""),
            completion_promise=state.get("completion_promise"),
            metadata=state.get("metadata", {})
        )

        if self.backend_type == "local":
            state_path = self._get_state_path(state_id)
            with open(state_path, "w") as f:
                json.dump(asdict(ralph_state), f, indent=2)
        elif self.backend_type == "redis":
            key = f"ralph:state:{state_id}"
            self._redis_client.setex(key, self.ttl, json.dumps(asdict(ralph_state)))

        return ralph_state

    def get(self, state_id: str) -> Optional[RalphState]:
        """获取状态"""
        if self.backend_type == "local":
            state_path = self._get_state_path(state_id)
            if not state_path.exists():
                return None
            with open(state_path, "r") as f:
                data = json.load(f)
        elif self.backend_type == "redis":
            key = f"ralph:state:{state_id}"
            data = self._redis_client.get(key)
            if not data:
                return None
            data = json.loads(data)

        return RalphState(**data)

    def update(self, state_id: str, **kwargs) -> Optional[RalphState]:
        """更新状态"""
        state = self.get(state_id)
        if not state:
            return None

        for key, value in kwargs.items():
            if hasattr(state, key):
                setattr(state, key, value)

        from datetime import datetime
        state.updated_at = datetime.now().isoformat()

        if self.backend_type == "local":
            state_path = self._get_state_path(state_id)
            with open(state_path, "w") as f:
                json.dump(asdict(state), f, indent=2)
        elif self.backend_type == "redis":
            key = f"ralph:state:{state_id}"
            self._redis_client.setex(key, self.ttl, json.dumps(asdict(state)))

        return state

    def delete(self, state_id: str) -> bool:
        """删除状态"""
        if self.backend_type == "local":
            state_path = self._get_state_path(state_id)
            if state_path.exists():
                state_path.unlink()
                return True
            return False
        elif self.backend_type == "redis":
            key = f"ralph:state:{state_id}"
            return self._redis_client.delete(key) > 0

    def acquire_lock(self, state_id: str, timeout: int = 30) -> bool:
        """获取状态锁（防止并发修改）"""
        lock_key = f"ralph:lock:{state_id}"

        if self.backend_type == "local":
            lock_path = self._get_state_path(state_id).with_suffix(".lock")
            try:
                fd = open(lock_path, "w")
                fcntl.flock(fd.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                fd.write(str(time.time()))
                return True
            except (IOError, OSError):
                return False
        elif self.backend_type == "redis":
            return self._redis_client.set(lock_key, "1", nx=True, ex=timeout) is True

    def release_lock(self, state_id: str) -> bool:
        """释放状态锁"""
        lock_key = f"ralph:lock:{state_id}"

        if self.backend_type == "local":
            lock_path = self._get_state_path(state_id).with_suffix(".lock")
            try:
                fd = open(lock_path, "w")
                fcntl.flock(fd.fileno(), fcntl.LOCK_UN)
                fd.close()
                lock_path.unlink(missing_ok=True)
                return True
            except (IOError, OSError):
                return False
        elif self.backend_type == "redis":
            return self._redis_client.delete(lock_key) > 0

    def list_states(self, pattern: str = "*") -> list:
        """列出所有状态"""
        if self.backend_type == "local":
            import glob
            files = glob.glob(str(self.base_path / f"{pattern}.json"))
            return [Path(f).stem for f in files]
        elif self.backend_type == "redis":
            keys = self._redis_client.keys("ralph:state:*")
            return [k.decode().replace("ralph:state:", "") for k in keys]

    def get_all_states(self) -> Dict[str, RalphState]:
        """获取所有状态的详细信息"""
        state_ids = self.list_states()
        return {sid: self.get(sid) for sid in state_ids if self.get(sid)}
```

**Step 4: 运行测试验证通过**

```bash
pytest tests/test_state_storage.py -v
Expected: PASS
```

**Step 5: 提交**

```bash
git add tests/test_state_storage.py ralph-loop-enhanced/state/
git commit -m "feat: add state storage module with local and Redis backends"
```

---

### Task 2: 创建终止条件引擎

**文件：**
- 创建: `ralph-loop-enhanced/termination/engine.py`
- 创建: `ralph-loop-enhanced/termination/conditions.py`
- 测试: `tests/test_termination.py`

**Step 1: 编写失败的测试**

```python
# tests/test_termination.py
import pytest
from ralph_loop_enhanced.termination.engine import TerminationEngine, TerminationReason
from ralph_loop_enhanced.termination.conditions import (
    MaxIterationsCondition,
    PromiseCondition,
    FileExistsCondition,
    ApiResponseCondition,
    CompositeCondition,
    AnyCondition,
    AllCondition
)

def test_max_iterations_condition():
    condition = MaxIterationsCondition(max_iterations=5)

    # 未达到最大值
    result = condition.check(iteration=3, max_iterations=5, output="test")
    assert result.terminated is False
    assert result.reason == TerminationReason.NOT_TERMINATED

    # 达到最大值
    result = condition.check(iteration=5, max_iterations=5, output="test")
    assert result.terminated is True
    assert result.reason == TerminationReason.MAX_ITERATIONS

def test_promise_condition():
    condition = PromiseCondition(promise="FIXED")

    # 找到 promise
    result = condition.check(iteration=1, max_iterations=10, output="Fixed the bug <promise>FIXED</promise>")
    assert result.terminated is True
    assert result.reason == TerminationReason.PROMISE_MATCHED

    # 未找到 promise
    result = condition.check(iteration=1, max_iterations=10, output="Still working...")
    assert result.terminated is False
    assert result.reason == TerminationReason.NOT_TERMINATED

def test_file_exists_condition(tmp_path):
    condition = FileExistsCondition(pattern="**/test.txt")

    # 文件存在
    test_file = tmp_path / "test.txt"
    test_file.write_text("content")

    result = condition.check(iteration=1, max_iterations=10, output="done", base_path=str(tmp_path))
    assert result.terminated is True
    assert result.reason == TerminationReason.FILE_EXISTS

    # 文件不存在
    condition2 = FileExistsCondition(pattern="**/missing.txt")
    result2 = condition2.check(iteration=1, max_iterations=10, output="done", base_path=str(tmp_path))
    assert result2.terminated is False

def test_composite_any_condition():
    condition = AnyCondition([
        MaxIterationsCondition(max_iterations=3),
        PromiseCondition(promise="DONE")
    ])

    # 第一个条件满足
    result = condition.check(iteration=3, max_iterations=5, output="working")
    assert result.terminated is True
    assert result.reason == TerminationReason.MAX_ITERATIONS

    # 第二个条件满足
    result = condition.check(iteration=1, max_iterations=5, output="Complete <promise>DONE</promise>")
    assert result.terminated is True
    assert result.reason == TerminationReason.PROMISE_MATCHED

    # 都不满足
    result = condition.check(iteration=1, max_iterations=5, output="still working")
    assert result.terminated is False

def test_termination_engine():
    engine = TerminationEngine([
        MaxIterationsCondition(max_iterations=5),
        PromiseCondition(promise="SUCCESS")
    ])

    result = engine.evaluate(iteration=3, max_iterations=5, output="<promise>SUCCESS</promise>")
    assert result.terminated is True
```

**Step 2: 运行测试验证失败**

```bash
pytest tests/test_termination.py -v
Expected: FAIL - ModuleNotFoundError
```

**Step 3: 实现终止条件引擎**

```python
# ralph-loop-enhanced/termination/conditions.py
from abc import ABC, abstractmethod
from typing import Dict, Any, Optional, List, Literal
from dataclasses import dataclass
from enum import Enum
import re
import glob
import os

class TerminationReason(Enum):
    NOT_TERMINATED = "not_terminated"
    MAX_ITERATIONS = "max_iterations"
    PROMISE_MATCHED = "promise_matched"
    FILE_EXISTS = "file_exists"
    API_RESPONSE = "api_response"
    TIMEOUT = "timeout"
    EXTERNAL_SIGNAL = "external_signal"
    ERROR = "error"

@dataclass
class TerminationResult:
    terminated: bool
    reason: TerminationReason
    details: Optional[Dict[str, Any]] = None
    message: Optional[str] = None

class TerminationCondition(ABC):
    """终止条件基类"""

    @abstractmethod
    def check(
        self,
        iteration: int,
        max_iterations: int,
        output: str,
        **kwargs
    ) -> TerminationResult:
        """检查是否满足终止条件"""
        pass

    @abstractmethod
    def to_dict(self) -> Dict[str, Any]:
        """序列化条件为字典"""
        pass

    @classmethod
    @abstractmethod
    def from_dict(cls, data: Dict[str, Any]) -> "TerminationCondition":
        """从字典反序列化条件"""
        pass

class MaxIterationsCondition(TerminationCondition):
    """最大迭代次数条件"""

    def __init__(self, max_iterations: int = 0):
        self.max_iterations = max_iterations

    def check(
        self,
        iteration: int,
        max_iterations: int,
        output: str,
        **kwargs
    ) -> TerminationResult:
        effective_max = self.max_iterations if self.max_iterations > 0 else max_iterations

        if effective_max > 0 and iteration >= effective_max:
            return TerminationResult(
                terminated=True,
                reason=TerminationReason.MAX_ITERATIONS,
                details={"iteration": iteration, "max": effective_max},
                message=f"达到最大迭代次数: {iteration}/{effective_max}"
            )

        return TerminationResult(
            terminated=False,
            reason=TerminationReason.NOT_TERMINATED
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "type": "max_iterations",
            "max_iterations": self.max_iterations
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "MaxIterationsCondition":
        return cls(max_iterations=data.get("max_iterations", 0))

class PromiseCondition(TerminationCondition):
    """Promise 标签匹配条件"""

    def __init__(self, promise: str, exact_match: bool = True):
        self.promise = promise
        self.exact_match = exact_match

    def check(
        self,
        iteration: int,
        max_iterations: int,
        output: str,
        **kwargs
    ) -> TerminationResult:
        # 使用正则提取 <promise> 标签内容
        pattern = r'<promise>(.*?)</promise>'
        matches = re.findall(pattern, output, re.DOTALL)

        for match in matches:
            match = match.strip()
            if self.exact_match:
                if match == self.promise:
                    return TerminationResult(
                        terminated=True,
                        reason=TerminationReason.PROMISE_MATCHED,
                        details={"promise": self.promise, "matched": match},
                        message=f"Promise 匹配成功: {self.promise}"
                    )
            else:
                if self.promise in match:
                    return TerminationResult(
                        terminated=True,
                        reason=TerminationReason.PROMISE_MATCHED,
                        details={"promise_pattern": self.promise, "matched": match},
                        message=f"Promise 模式匹配成功: {self.promise}"
                    )

        return TerminationResult(
            terminated=False,
            reason=TerminationReason.NOT_TERMINATED
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "type": "promise",
            "promise": self.promise,
            "exact_match": self.exact_match
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "PromiseCondition":
        return cls(
            promise=data.get("promise", ""),
            exact_match=data.get("exact_match", True)
        )

class FileExistsCondition(TerminationCondition):
    """文件存在条件"""

    def __init__(
        self,
        pattern: str,
        base_path_key: str = "base_path",
        must_exist: bool = True
    ):
        self.pattern = pattern
        self.base_path_key = base_path_key
        self.must_exist = must_exist

    def check(
        self,
        iteration: int,
        max_iterations: int,
        output: str,
        base_path: str = ".",
        **kwargs
    ) -> TerminationResult:
        # 构建完整模式
        full_pattern = os.path.join(base_path, self.pattern)
        files = glob.glob(full_pattern, recursive=True)

        exists = len(files) > 0

        if self.must_exist and exists:
            return TerminationResult(
                terminated=True,
                reason=TerminationReason.FILE_EXISTS,
                details={"pattern": self.pattern, "files": files},
                message=f"文件匹配成功: {self.pattern}"
            )
        elif not self.must_exist and not exists:
            return TerminationResult(
                terminated=True,
                reason=TerminationReason.FILE_EXISTS,
                details={"pattern": self.pattern},
                message=f"文件不存在: {self.pattern}"
            )

        return TerminationResult(
            terminated=False,
            reason=TerminationReason.NOT_TERMINATED
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "type": "file_exists",
            "pattern": self.pattern,
            "base_path_key": self.base_path_key,
            "must_exist": self.must_exist
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "FileExistsCondition":
        return cls(
            pattern=data.get("pattern", ""),
            base_path_key=data.get("base_path_key", "base_path"),
            must_exist=data.get("must_exist", True)
        )

class ApiResponseCondition(TerminationCondition):
    """API 响应条件"""

    def __init__(
        self,
        url: str,
        expected_status: int = 200,
        method: str = "GET",
        timeout: int = 10
    ):
        self.url = url
        self.expected_status = expected_status
        self.method = method
        self.timeout = timeout

    def check(
        self,
        iteration: int,
        max_iterations: int,
        output: str,
        **kwargs
    ) -> TerminationResult:
        try:
            import requests

            response = requests.request(
                self.method,
                self.url,
                timeout=self.timeout
            )

            if response.status_code == self.expected_status:
                return TerminationResult(
                    terminated=True,
                    reason=TerminationReason.API_RESPONSE,
                    details={
                        "url": self.url,
                        "status": response.status_code
                    },
                    message=f"API 响应符合预期: {self.url} -> {response.status_code}"
                )

            return TerminationResult(
                terminated=False,
                reason=TerminationReason.NOT_TERMINATED,
                details={"url": self.url, "status": response.status_code}
            )

        except Exception as e:
            return TerminationResult(
                terminated=False,
                reason=TerminationReason.NOT_TERMINATED,
                details={"error": str(e)}
            )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "type": "api_response",
            "url": self.url,
            "expected_status": self.expected_status,
            "method": self.method,
            "timeout": self.timeout
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ApiResponseCondition":
        return cls(
            url=data.get("url", ""),
            expected_status=data.get("expected_status", 200),
            method=data.get("method", "GET"),
            timeout=data.get("timeout", 10)
        )

class CompositeCondition(TerminationCondition):
    """组合条件基类"""

    def __init__(self, conditions: List[TerminationCondition]):
        self.conditions = conditions

    def to_dict(self) -> Dict[str, Any]:
        return {
            "type": self.get_type(),
            "conditions": [c.to_dict() for c in self.conditions]
        }

class AnyCondition(CompositeCondition):
    """任意条件满足即终止 (OR)"""

    def get_type(self) -> str:
        return "any"

    def check(
        self,
        iteration: int,
        max_iterations: int,
        output: str,
        **kwargs
    ) -> TerminationResult:
        for condition in self.conditions:
            result = condition.check(iteration, max_iterations, output, **kwargs)
            if result.terminated:
                return result

        return TerminationResult(
            terminated=False,
            reason=TerminationReason.NOT_TERMINATED
        )

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "AnyCondition":
        conditions = [condition_from_dict(c) for c in data.get("conditions", [])]
        return cls(conditions)

class AllCondition(CompositeCondition):
    """所有条件满足才终止 (AND)"""

    def get_type(self) -> str:
        return "all"

    def check(
        self,
        iteration: int,
        max_iterations: int,
        output: str,
        **kwargs
    ) -> TerminationResult:
        all_terminated = True
        results = []

        for condition in self.conditions:
            result = condition.check(iteration, max_iterations, output, **kwargs)
            results.append(result)
            if not result.terminated:
                all_terminated = False

        if all_terminated and results:
            return TerminationResult(
                terminated=True,
                reason=results[0].reason,
                details={"conditions": [r.to_dict() for r in results]},
                message="所有条件都满足"
            )

        return TerminationResult(
            terminated=False,
            reason=TerminationReason.NOT_TERMINATED
        )

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "AllCondition":
        conditions = [condition_from_dict(c) for c in data.get("conditions", [])]
        return cls(conditions)

def condition_from_dict(data: Dict[str, Any]) -> TerminationCondition:
    """从字典创建终止条件"""
    type_map = {
        "max_iterations": MaxIterationsCondition,
        "promise": PromiseCondition,
        "file_exists": FileExistsCondition,
        "api_response": ApiResponseCondition,
        "any": AnyCondition,
        "all": AllCondition,
    }

    condition_type = data.get("type")
    if condition_type in type_map:
        return type_map[condition_type].from_dict(data)

    raise ValueError(f"Unknown condition type: {condition_type}")
```

```python
# ralph-loop-enhanced/termination/engine.py
from typing import List, Dict, Any
from .conditions import (
    TerminationCondition,
    TerminationResult,
    TerminationReason,
    condition_from_dict
)

class TerminationEngine:
    """终止条件评估引擎"""

    def __init__(self, conditions: List[TerminationCondition]):
        self.conditions = conditions

    def evaluate(
        self,
        iteration: int,
        max_iterations: int,
        output: str,
        **kwargs
    ) -> TerminationResult:
        """评估所有终止条件"""
        for condition in self.conditions:
            result = condition.check(iteration, max_iterations, output, **kwargs)
            if result.terminated:
                return result

        return TerminationResult(
            terminated=False,
            reason=TerminationReason.NOT_TERMINATED
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "conditions": [c.to_dict() for c in self.conditions]
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "TerminationEngine":
        conditions = [condition_from_dict(c) for c in data.get("conditions", [])]
        return cls(conditions)
```

**Step 4: 运行测试验证通过**

```bash
pytest tests/test_termination.py -v
Expected: PASS
```

**Step 5: 提交**

```bash
git add tests/test_termination.py ralph-loop-enhanced/termination/
git commit -m "feat: add termination condition engine with multiple condition types"
```

---

## 第二阶段：中间件机制

### Task 3: 创建中间件框架

**文件：**
- 创建: `ralph-loop-enhanced/middleware/core.py`
- 创建: `ralph-loop-enhanced/middleware/events.py`
- 测试: `tests/test_middleware.py`

**Step 1: 编写失败的测试**

```python
# tests/test_middleware.py
import pytest
from ralph_loop_enhanced.middleware.core import MiddlewareEngine, MiddlewareContext
from ralph_loop_enhanced.middleware.events import RalphEvent, EventType

class TestMiddleware:
    def test_logging_middleware(self):
        logs = []

        def logging_middleware(context: MiddlewareContext, next_handler):
            logs.append(f"before: {context.state.iteration}")
            next_handler()
            logs.append(f"after: {context.state.iteration}")

        engine = MiddlewareEngine()
        engine.add_middleware(logging_middleware, events=[RalphEvent.BEFORE_ITERATION])

        # 模拟执行
        context = MiddlewareContext(
            state_id="test",
            iteration=1,
            prompt="test"
        )

        def dummy_handler():
            context.state.iteration = 2

        engine.execute(context, dummy_handler)

        assert len(logs) == 2
        assert logs[0] == "before: 1"
        assert logs[1] == "after: 2"

    def test_notification_middleware(self):
        notifications = []

        def notify_middleware(context: MiddlewareContext, next_handler):
            if context.state.iteration >= 5:
                notifications.append(f"Iteration {context.state.iteration} complete!")
            next_handler()

        engine = MiddlewareEngine()
        engine.add_middleware(notify_middleware, events=[RalphEvent.AFTER_ITERATION])

        context = MiddlewareContext(
            state_id="test",
            iteration=5,
            prompt="test"
        )

        def dummy_handler():
            pass

        engine.execute(context, dummy_handler)

        assert len(notifications) == 1
        assert notifications[0] == "Iteration 5 complete!"

    def test_middleware_chaining(self):
        order = []

        def first(context: MiddlewareContext, next_handler):
            order.append("first_before")
            next_handler()
            order.append("first_after")

        def second(context: MiddlewareContext, next_handler):
            order.append("second_before")
            next_handler()
            order.append("second_after")

        engine = MiddlewareEngine()
        engine.add_middleware(first)
        engine.add_middleware(second)

        context = MiddlewareContext(state_id="test", iteration=1, prompt="test")

        def final_handler():
            order.append("handler")

        engine.execute(context, final_handler)

        assert order == [
            "first_before",
            "second_before",
            "handler",
            "second_after",
            "first_after"
        ]
```

**Step 2: 运行测试验证失败**

```bash
pytest tests/test_middleware.py -v
Expected: FAIL - ModuleNotFoundError
```

**Step 3: 实现中间件框架**

```python
# ralph-loop-enhanced/middleware/events.py
from enum import Enum
from dataclasses import dataclass
from typing import Any, Dict, Optional
from datetime import datetime

class EventType(Enum):
    """Ralph Loop 事件类型"""
    BEFORE_LOOP = "before_loop"
    AFTER_LOOP = "after_loop"
    BEFORE_ITERATION = "before_iteration"
    AFTER_ITERATION = "after_iteration"
    BEFORE_TOOL_CALL = "before_tool_call"
    AFTER_TOOL_CALL = "after_tool_call"
    ON_TERMINATION = "on_termination"
    ON_ERROR = "on_error"

@dataclass
class RalphEvent:
    """Ralph Loop 事件"""
    type: EventType
    timestamp: str
    data: Dict[str, Any]

    @classmethod
    def create(cls, event_type: EventType, **data) -> "RalphEvent":
        return cls(
            type=event_type,
            timestamp=datetime.now().isoformat(),
            data=data
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "type": self.type.value,
            "timestamp": self.timestamp,
            "data": self.data
        }
```

```python
# ralph-loop-enhanced/middleware/core.py
from typing import Callable, List, Dict, Any, Optional
from dataclasses import dataclass, field
from .events import RalphEvent, EventType

@dataclass
class RalphState:
    """Ralph Loop 状态（用于中间件上下文）"""
    iteration: int
    max_iterations: int
    prompt: str
    completion_promise: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

@dataclass
class MiddlewareContext:
    """中间件执行上下文"""
    state_id: str
    iteration: int
    prompt: str
    output: Optional[str] = None
    error: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    @property
    def state(self) -> RalphState:
        """获取状态对象"""
        return RalphState(
            iteration=self.iteration,
            max_iterations=0,  # 可从 metadata 获取
            prompt=self.prompt
        )

MiddlewareHandler = Callable[[MiddlewareContext], None]
MiddlewareFunction = Callable[[MiddlewareContext, MiddlewareHandler], None]

class MiddlewareEngine:
    """中间件引擎"""

    def __init__(self):
        self._middlewares: List[Dict[str, Any]] = []

    def add_middleware(
        self,
        func: MiddlewareFunction,
        events: List[EventType] = None,
        priority: int = 0
    ):
        """添加中间件"""
        self._middlewares.append({
            "func": func,
            "events": events or list(EventType),
            "priority": priority
        })
        # 按优先级排序
        self._middlewares.sort(key=lambda m: m["priority"])

    def remove_middleware(self, func: MiddlewareFunction):
        """移除中间件"""
        self._middlewares = [m for m in self._middlewares if m["func"] != func]

    def execute(
        self,
        context: MiddlewareContext,
        final_handler: MiddlewareHandler,
        event_type: EventType = EventType.BEFORE_ITERATION
    ):
        """执行中间件链"""
        def create_next_handler(index: int) -> MiddlewareHandler:
            if index >= len(self._middlewares):
                return final_handler

            middleware = self._middlewares[index]
            # 检查是否监听此事件
            if event_type not in middleware["events"]:
                return create_next_handler(index + 1)

            func = middleware["func"]

            def next_middleware_handler(ctx: MiddlewareContext):
                def inner_next():
                    create_next_handler(index + 1)(ctx)
                func(ctx, inner_next)

            return next_middleware_handler

        create_next_handler(0)(context)

    def execute_event(
        self,
        event: RalphEvent,
        context: MiddlewareContext
    ):
        """执行特定事件的中间件"""
        def final_handler(ctx: MiddlewareContext):
            pass

        self.execute(context, final_handler, event.type)

    def get_middleware_info(self) -> List[Dict[str, Any]]:
        """获取中间件信息"""
        return [
            {
                "func_name": m["func"].__name__,
                "events": [e.value for e in m["events"]],
                "priority": m["priority"]
            }
            for m in self._middlewares
        ]
```

**Step 4: 运行测试验证通过**

```bash
pytest tests/test_middleware.py -v
Expected: PASS
```

**Step 5: 提交**

```bash
git add tests/test_middleware.py ralph-loop-enhanced/middleware/
git commit -m "feat: add middleware framework with event system"
```

---

### Task 4: 创建预定义中间件 ✅ 已完成

**文件：**
- ✅ 创建: `ralph-loop-enhanced/middleware/predefined.py`
- ✅ 测试: `tests/test_predefined_middleware.py`
- ✅ 提交: cd8f0bb

**实现内容：**
- LoggingMiddleware: 日志记录中间件（JSON/文本格式）
- NotificationMiddleware: 通知中间件（Webhook/Slack）
- MetricsMiddleware: 指标收集中间件
- MetricsCollector: 指标收集器（线程安全）
- 工厂函数和便捷添加函数

**完成时间：** 2026-01-30 18:17

**Step 1: 编写失败的测试**

```python
# tests/test_predefined_middleware.py
import pytest
import json
from ralph_loop_enhanced.middleware.predefined import (
    LoggingMiddleware,
    NotificationMiddleware,
    MetricsMiddleware,
    MetricsCollector
)

def test_logging_middleware(tmp_path):
    log_file = tmp_path / "ralph.log"
    middleware = LoggingMiddleware(log_file=str(log_file))

    # 测试日志记录
    from ralph_loop_enhanced.middleware.core import MiddlewareContext

    context = MiddlewareContext(
        state_id="test-loop",
        iteration=3,
        prompt="Build a REST API",
        output="Added user endpoint"
    )

    def next_handler(ctx):
        pass

    middleware.execute(context, next_handler)

    # 验证日志文件
    assert log_file.exists()
    lines = log_file.read_text().strip().split("\n")
    assert len(lines) == 1

    log_entry = json.loads(lines[0])
    assert log_entry["state_id"] == "test-loop"
    assert log_entry["iteration"] == 3

def test_metrics_collector():
    collector = MetricsCollector()

    # 记录指标
    collector.record("iteration", 1)
    collector.record("iteration", 2)
    collector.record("iteration", 3)

    stats = collector.get_stats()

    assert stats["iteration"]["count"] == 3
    assert stats["iteration"]["min"] == 1
    assert stats["iteration"]["max"] == 3
    assert stats["iteration"]["avg"] == 2.0
```

**Step 2: 运行测试验证失败**

```bash
pytest tests/test_predefined_middleware.py -v
Expected: FAIL
```

**Step 3: 实现预定义中间件**

```python
# ralph-loop-enhanced/middleware/predefined.py
import json
import os
import time
from typing import Dict, Any, Optional, List
from datetime import datetime
from .core import MiddlewareContext, MiddlewareHandler, MiddlewareEngine, MiddlewareFunction
from .events import RalphEvent, EventType

class LoggingMiddleware:
    """日志记录中间件"""

    def __init__(
        self,
        log_file: str = ".claude/ralph-loop.log",
        format: str = "json"
    ):
        self.log_file = log_file
        self.format = format

        # 确保目录存在
        os.makedirs(os.path.dirname(log_file), exist_ok=True)

    def execute(self, context: MiddlewareContext, next_handler: MiddlewareHandler):
        """执行日志记录"""
        log_entry = {
            "timestamp": datetime.now().isoformat(),
            "state_id": context.state_id,
            "iteration": context.iteration,
            "prompt": context.prompt,
            "output": context.output,
            "event": "before_iteration"
        }

        self._write_log(log_entry)
        next_handler(context)

        # 迭代后记录
        log_entry_after = log_entry.copy()
        log_entry_after["event"] = "after_iteration"
        log_entry_after["output"] = context.output
        self._write_log(log_entry_after)

    def _write_log(self, entry: Dict[str, Any]):
        if self.format == "json":
            with open(self.log_file, "a") as f:
                f.write(json.dumps(entry) + "\n")
        else:
            with open(self.log_file, "a") as f:
                f.write(f"[{entry['timestamp']}] {entry['event']}: {entry['state_id']} - iter {entry['iteration']}\n")

class NotificationMiddleware:
    """通知中间件"""

    def __init__(
        self,
        webhook_url: Optional[str] = None,
        slack_webhook: Optional[str] = None
    ):
        self.webhook_url = webhook_url
        self.slack_webhook = slack_webhook

    def execute(self, context: MiddlewareContext, next_handler: MiddlewareHandler):
        """执行通知"""
        if context.iteration % 5 == 0:
            self._send_notification(
                f"Ralph Loop `{context.state_id}` 已完成 {context.iteration} 次迭代"
            )

        next_handler(context)

        # 检查是否终止
        if context.output and "<promise>" in context.output:
            self._send_notification(
                f"Ralph Loop `{context.state_id}` 已完成！\n"
                f"迭代次数: {context.iteration}\n"
                f"输出: {context.output[:200]}"
            )

    def _send_notification(self, message: str):
        import requests

        if self.webhook_url:
            try:
                requests.post(self.webhook_url, json={"message": message}, timeout=5)
            except Exception:
                pass

        if self.slack_webhook:
            try:
                requests.post(
                    self.slack_webhook,
                    json={"text": message},
                    timeout=5
                )
            except Exception:
                pass

class MetricsMiddleware:
    """指标收集中间件"""

    def __init__(self, collector: "MetricsCollector" = None):
        self.collector = collector or MetricsCollector()

    def execute(self, context: MiddlewareContext, next_handler: MiddlewareHandler):
        """收集指标"""
        start_time = time.time()

        next_handler(context)

        duration = time.time() - start_time

        self.collector.record("iteration_duration_seconds", duration)
        self.collector.record("iteration", context.iteration)
        self.collector.record("total_iterations")

    def get_metrics(self) -> Dict[str, Any]:
        return self.collector.get_stats()

class MetricsCollector:
    """指标收集器"""

    def __init__(self):
        self._metrics: Dict[str, List[Any]] = {}

    def record(self, key: str, value: Any = None):
        if key not in self._metrics:
            self._metrics[key] = []

        if value is not None:
            self._metrics[key].append(value)
        else:
            # 计数类型
            if "_count" not in self._metrics:
                self._metrics[key + "_count"] = []
            self._metrics[key + "_count"].append(1)

    def get_stats(self) -> Dict[str, Any]:
        stats = {}

        for key, values in self._metrics.items():
            if key.endswith("_count"):
                stats[key] = sum(values)
            elif values:
                import statistics
                numeric_values = [v for v in values if isinstance(v, (int, float))]
                if numeric_values:
                    stats[key] = {
                        "count": len(numeric_values),
                        "min": min(numeric_values),
                        "max": max(numeric_values),
                        "avg": round(statistics.mean(numeric_values), 3),
                        "latest": numeric_values[-1] if numeric_values else None
                    }
                else:
                    stats[key] = {"count": len(values), "values": values[-5:]}
            else:
                stats[key] = {"count": 0}

        return stats

    def reset(self):
        self._metrics = {}

    def export(self) -> Dict[str, Any]:
        return {
            "metrics": self._metrics,
            "stats": self.get_stats()
        }

def create_logging_middleware(log_file: str = ".claude/ralph-loop.log") -> MiddlewareFunction:
    """创建日志中间件工厂"""
    def middleware(context: MiddlewareContext, next_handler: MiddlewareHandler):
        LoggingMiddleware(log_file).execute(context, next_handler)
    return middleware

def create_notification_middleware(
    webhook_url: Optional[str] = None,
    slack_webhook: Optional[str] = None
) -> MiddlewareFunction:
    """创建通知中间件工厂"""
    def middleware(context: MiddlewareContext, next_handler: MiddlewareHandler):
        NotificationMiddleware(webhook_url, slack_webhook).execute(context, next_handler)
    return middleware

def create_metrics_middleware(collector: MetricsCollector = None) -> MiddlewareFunction:
    """创建指标中间件工厂"""
    def middleware(context: MiddlewareContext, next_handler: MiddlewareHandler):
        MetricsMiddleware(collector).execute(context, next_handler)
    return middleware
```

**Step 4: 运行测试验证通过**

```bash
pytest tests/test_predefined_middleware.py -v
Expected: PASS
```

**Step 5: 提交**

```bash
git add tests/test_predefined_middleware.py ralph-loop-enhanced/middleware/predefined.py
git commit -m "feat: add predefined middleware (logging, notification, metrics)"
```

---

## 第三阶段：并行 Ralph 与核心引擎

### Task 5: 创建并行 Ralph 引擎

**文件：**
- 创建: `ralph-loop-enhanced/engine/core.py`
- 创建: `ralph-loop-enhanced/engine/parallel.py`
- 测试: `tests/test_engine.py`

**Step 1: 编写失败的测试**

```python
# tests/test_engine.py
import pytest
import time
from ralph_loop_enhanced.engine.core import RalphEngine, ParallelRalphEngine
from ralph_loop_enhanced.state.storage import StateStorage
from ralph_loop_enhanced.termination.engine import TerminationEngine
from ralph_loop_enhanced.termination.conditions import MaxIterationsCondition, PromiseCondition

def test_sequential_ralph_engine():
    """测试顺序 Ralph 引擎"""
    storage = StateStorage(backend_type="local", base_path="/tmp/ralph-test-engine")
    termination = TerminationEngine([
        MaxIterationsCondition(max_iterations=3)
    ])

    engine = RalphEngine(
        storage=storage,
        termination_engine=termination
    )

    # 模拟运行
    results = []

    def on_iteration(iteration, state):
        results.append(iteration)

    engine.run(
        state_id="test-1",
        prompt="Count to 3",
        max_iterations=3,
        on_iteration=on_iteration
    )

    assert len(results) == 3
    assert results == [1, 2, 3]

def test_parallel_ralph_engine():
    """测试并行 Ralph 引擎"""
    storage = StateStorage(backend_type="local", base_path="/tmp/ralph-test-engine")
    termination = TerminationEngine([
        MaxIterationsCondition(max_iterations=2)
    ])

    parallel_engine = ParallelRalphEngine(
        storage=storage,
        termination_engine=termination,
        max_workers=2
    )

    # 提交多个任务
    task_ids = ["parallel-1", "parallel-2", "parallel-3"]

    for tid in task_ids:
        parallel_engine.submit(
            state_id=tid,
            prompt=f"Task {tid}",
            max_iterations=2
        )

    # 等待完成
    parallel_engine.wait_all()

    # 验证所有任务完成
    for tid in task_ids:
        state = storage.get(tid)
        assert state is not None
        assert state.iteration >= 2
```

**Step 2: 运行测试验证失败**

```bash
pytest tests/test_engine.py -v
Expected: FAIL
```

**Step 3: 实现引擎**

```python
# ralph-loop-enhanced/engine/core.py
import subprocess
import sys
from typing import Optional, Callable, Dict, Any
from ..state.storage import StateStorage, RalphState
from ..termination.engine import TerminationEngine, TerminationResult
from ..middleware.core import MiddlewareEngine, MiddlewareContext
from ..middleware.predefined import LoggingMiddleware, MetricsMiddleware

class RalphEngine:
    """Ralph Loop 核心引擎"""

    def __init__(
        self,
        storage: StateStorage,
        termination_engine: TerminationEngine,
        middleware_engine: MiddlewareEngine = None,
        working_dir: str = "."
    ):
        self.storage = storage
        self.termination = termination_engine
        self.middleware = middleware_engine or MiddlewareEngine()
        self.working_dir = working_dir

        # 默认中间件
        self.middleware.add_middleware(
            LoggingMiddleware(log_file=f"{working_dir}/.claude/ralph-loop.log").execute,
            priority=100
        )

    def run(
        self,
        state_id: str,
        prompt: str,
        max_iterations: int = 0,
        completion_promise: Optional[str] = None,
        on_iteration: Callable[[int, RalphState], None] = None,
        on_complete: Callable[[TerminationResult], None] = None,
        on_error: Callable[[Exception], None] = None
    ):
        """运行 Ralph Loop"""
        # 初始化状态
        self.storage.create(state_id, {
            "iteration": 1,
            "max_iterations": max_iterations,
            "prompt": prompt,
            "completion_promise": completion_promise,
            "metadata": {"engine": "ralph-enhanced"}
        })

        while True:
            # 获取当前状态
            state = self.storage.get(state_id)
            if not state:
                break

            # 创建中间件上下文
            context = MiddlewareContext(
                state_id=state_id,
                iteration=state.iteration,
                prompt=state.prompt
            )

            # 执行迭代
            try:
                # 运行外部 Claude 进程
                output = self._run_claude_iteration(
                    prompt=state.prompt,
                    iteration=state.iteration,
                    state_id=state_id
                )

                context.output = output

                # 检查终止条件
                result = self.termination.evaluate(
                    iteration=state.iteration,
                    max_iterations=state.max_iterations,
                    output=output,
                    base_path=self.working_dir
                )

                if result.terminated:
                    if on_complete:
                        on_complete(result)
                    break

                # 回调
                if on_iteration:
                    on_iteration(state.iteration, state)

                # 更新迭代
                self.storage.update(state_id, iteration=state.iteration + 1)

            except Exception as e:
                context.error = str(e)
                if on_error:
                    on_error(e)
                break

    def _run_claude_iteration(
        self,
        prompt: str,
        iteration: int,
        state_id: str
    ) -> str:
        """运行单次迭代（调用 Claude Code）"""
        # 构建命令
        cmd = [
            "claude",
            "--print", prompt,
            "--output-format", "stream-json",
            "--session-id", state_id
        ]

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            cwd=self.working_dir,
            timeout=300
        )

        # 解析输出
        for line in result.stdout.split("\n"):
            if line.strip().startswith('{"type":"result"'):
                import json
                data = json.loads(line)
                return data.get("result", "")

        return result.stdout

class ParallelRalphEngine:
    """并行 Ralph 引擎"""

    def __init__(
        self,
        storage: StateStorage,
        termination_engine: TerminationEngine,
        max_workers: int = 3,
        middleware_engine: MiddlewareEngine = None,
        working_dir: str = "."
    ):
        self.storage = storage
        self.termination = termination_engine
        self.max_workers = max_workers
        self.middleware = middleware_engine or MiddlewareEngine()
        self.working_dir = working_dir

        from concurrent.futures import ThreadPoolExecutor, as_completed
        self._executor = ThreadPoolExecutor(max_workers=max_workers)
        self._futures: Dict[str, Any] = {}

    def submit(
        self,
        state_id: str,
        prompt: str,
        max_iterations: int = 0,
        completion_promise: Optional[str] = None
    ):
        """提交任务到并行引擎"""
        engine = RalphEngine(
            storage=self.storage,
            termination_engine=self.termination,
            middleware_engine=self.middleware,
            working_dir=self.working_dir
        )

        future = self._executor.submit(
            engine.run,
            state_id=state_id,
            prompt=prompt,
            max_iterations=max_iterations,
            completion_promise=completion_promise
        )

        self._futures[state_id] = future

    def wait_all(self, timeout: Optional[float] = None):
        """等待所有任务完成"""
        for state_id, future in list(self._futures.items()):
            try:
                future.result(timeout=timeout)
            except Exception as e:
                print(f"Task {state_id} failed: {e}")

        self._futures.clear()

    def get_status(self) -> Dict[str, Dict[str, Any]]:
        """获取所有任务状态"""
        status = {}
        for state_id in self._futures:
            future = self._futures[state_id]
            state = self.storage.get(state_id)
            status[state_id] = {
                "done": future.done(),
                "state": state.to_dict() if state else None
            }
        return status

    def shutdown(self):
        """关闭引擎"""
        self._executor.shutdown(wait=True)
```

**Step 4: 运行测试验证通过**

```bash
pytest tests/test_engine.py -v
Expected: PASS (可能需要 mock subprocess)
```

**Step 5: 提交**

```bash
git add tests/test_engine.py ralph-loop-enhanced/engine/
git commit -m "feat: add Ralph engine with parallel execution support"
```

---

## 第四阶段：可视化监控

### Task 6: 创建 Web 监控服务器

**文件：**
- 创建: `ralph-loop-enhanced/monitoring/server.py`
- 创建: `ralph-loop-enhanced/monitoring/api.py`
- 创建: `ralph-loop-enhanced/monitoring/static/index.html`
- 测试: `tests/test_monitoring.py`

**Step 1: 编写失败的测试**

```python
# tests/test_monitoring.py
import pytest
import json
from ralph_loop_enhanced.monitoring.server import create_app
from ralph_loop_enhanced.state.storage import StateStorage

def test_api_endpoints(tmp_path):
    """测试 API 端点"""
    storage = StateStorage(backend_type="local", base_path=str(tmp_path / "states"))

    app = create_app(storage)
    app.config["TESTING"] = True

    client = app.test_client()

    # 测试健康检查
    response = client.get("/api/health")
    assert response.status_code == 200
    data = json.loads(response.data)
    assert data["status"] == "ok"

    # 创建测试状态
    storage.create("test-1", {
        "iteration": 5,
        "max_iterations": 10,
        "prompt": "Test task"
    })

    # 测试获取所有状态
    response = client.get("/api/states")
    assert response.status_code == 200
    data = json.loads(response.data)
    assert "states" in data
    assert len(data["states"]) >= 1

    # 测试获取单个状态
    response = client.get("/api/states/test-1")
    assert response.status_code == 200
    data = json.loads(response.data)
    assert data["state"]["iteration"] == 5
```

**Step 2: 运行测试验证失败**

```bash
pytest tests/test_monitoring.py -v
Expected: FAIL
```

**Step 3: 实现监控服务器**

```python
# ralph-loop-enhanced/monitoring/server.py
from flask import Flask, jsonify, send_from_directory
from typing import Optional
import os

def create_app(
    storage,
    host: str = "0.0.0.0",
    port: int = 8080,
    static_folder: str = None
):
    """创建监控 Web 应用"""
    app = Flask(__name__, static_folder=static_folder)
    app.config["STORAGE"] = storage

    # API 路由
    @app.route("/api/health")
    def health():
        return jsonify({"status": "ok", "version": "1.0.0"})

    @app.route("/api/states")
    def states():
        storage = app.config["STORAGE"]
        all_states = storage.get_all_states()
        return jsonify({
            "states": [s.to_dict() for s in all_states.values()],
            "count": len(all_states)
        })

    @app.route("/api/states/<state_id>")
    def state_detail(state_id: str):
        storage = app.config["STORAGE"]
        state = storage.get(state_id)
        if state:
            return jsonify({"state": state.to_dict()})
        return jsonify({"error": "State not found"}), 404

    @app.route("/api/states/<state_id>", methods=["DELETE"])
    def delete_state(state_id: str):
        storage = app.config["STORAGE"]
        success = storage.delete(state_id)
        return jsonify({"success": success})

    @app.route("/api/metrics")
    def metrics():
        # 聚合指标
        storage = app.config["STORAGE"]
        all_states = storage.get_all_states()

        total_iterations = sum(s.iteration for s in all_states.values())
        active_loops = len([s for s in all_states.values() if s.iteration < (s.max_iterations or 999)])

        return jsonify({
            "total_iterations": total_iterations,
            "active_loops": active_loops,
            "completed_loops": len(all_states) - active_loops,
            "total_loops": len(all_states)
        })

    # Web 界面路由
    @app.route("/")
    def index():
        if static_folder and os.path.exists(os.path.join(static_folder, "index.html")):
            return send_from_directory(static_folder, "index.html")
        return """
        <!DOCTYPE html>
        <html>
        <head>
            <title>Ralph Loop Monitor</title>
            <script src="https://cdn.tailwindcss.com"></script>
            <script src="https://unpkg.com/vue@3/dist/vue.global.js"></script>
        </head>
        <body class="bg-gray-900 text-white p-8">
            <div id="app" class="max-w-6xl mx-auto">
                <h1 class="text-3xl font-bold mb-8">🔄 Ralph Loop Monitor</h1>

                <!-- Stats Cards -->
                <div class="grid grid-cols-4 gap-4 mb-8">
                    <div class="bg-gray-800 p-4 rounded-lg">
                        <div class="text-gray-400">Total Loops</div>
                        <div class="text-3xl font-bold">{{ metrics.total_loops }}</div>
                    </div>
                    <div class="bg-green-900 p-4 rounded-lg">
                        <div class="text-green-400">Active</div>
                        <div class="text-3xl font-bold">{{ metrics.active_loops }}</div>
                    </div>
                    <div class="bg-blue-900 p-4 rounded-lg">
                        <div class="text-blue-400">Completed</div>
                        <div class="text-3xl font-bold">{{ metrics.completed_loops }}</div>
                    </div>
                    <div class="bg-purple-900 p-4 rounded-lg">
                        <div class="text-purple-400">Total Iterations</div>
                        <div class="text-3xl font-bold">{{ metrics.total_iterations }}</div>
                    </div>
                </div>

                <!-- Loop List -->
                <div class="bg-gray-800 rounded-lg overflow-hidden">
                    <div class="p-4 border-b border-gray-700">
                        <h2 class="text-xl font-bold">Active Loops</h2>
                    </div>
                    <table class="w-full">
                        <thead class="bg-gray-700">
                            <tr>
                                <th class="p-3 text-left">State ID</th>
                                <th class="p-3 text-left">Iteration</th>
                                <th class="p-3 text-left">Progress</th>
                                <th class="p-3 text-left">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="state in states" :key="state.state_id" class="border-b border-gray-700">
                                <td class="p-3">{{ state.state_id }}</td>
                                <td class="p-3">{{ state.iteration }}<span v-if="state.max_iterations">/{{ state.max_iterations }}</span></td>
                                <td class="p-3">
                                    <div class="w-full bg-gray-700 rounded-full h-2">
                                        <div class="bg-green-500 h-2 rounded-full"
                                             :style="{ width: getProgress(state) + '%' }"></div>
                                    </div>
                                </td>
                                <td class="p-3">
                                    <span :class="getStatusClass(state)">{{ getStatus(state) }}</span>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <script>
                const { createApp, ref, onMounted } = Vue;

                createApp({
                    setup() {
                        const states = ref([]);
                        const metrics = ref({ total_loops: 0, active_loops: 0, completed_loops: 0, total_iterations: 0 });

                        const fetchData = async () => {
                            const [statesRes, metricsRes] = await Promise.all([
                                fetch('/api/states'),
                                fetch('/api/metrics')
                            ]);
                            states.value = (await statesRes.json()).states;
                            metrics.value = await metricsRes.json();
                        };

                        const getProgress = (state) => {
                            if (!state.max_iterations) return 100;
                            return Math.min(100, (state.iteration / state.max_iterations) * 100);
                        };

                        const getStatus = (state) => {
                            if (!state.max_iterations) return 'Running';
                            return state.iteration >= state.max_iterations ? 'Completed' : 'Running';
                        };

                        const getStatusClass = (state) => {
                            const status = getStatus(state);
                            return status === 'Completed' ? 'text-green-400' : 'text-yellow-400';
                        };

                        onMounted(() => {
                            fetchData();
                            setInterval(fetchData, 5000);
                        });

                        return { states, metrics, getProgress, getStatus, getStatusClass };
                    }
                }).mount('#app');
            </script>
        </body>
        </html>
        """

    return app
```

**Step 4: 运行测试验证通过**

```bash
pytest tests/test_monitoring.py -v
Expected: PASS
```

**Step 5: 提交**

```bash
git add tests/test_monitoring.py ralph-loop-enhanced/monitoring/
git commit -m "feat: add web monitoring server with Vue dashboard"
```

---

### Task 7: 创建 CLI 入口与配置文件

**文件：**
- 创建: `ralph-loop-enhanced/cli.py`
- 创建: `ralph-loop-enhanced/config.py`
- 创建: `ralph-loop-enhanced/__main__.py`
- 创建: `ralph-loop-enhanced/pyproject.toml`
- 测试: `tests/test_cli.py`

**Step 1: 编写失败的测试**

```python
# tests/test_cli.py
import pytest
from click.testing import CliRunner
from ralph_loop_enhanced.cli import cli

def test_cli_help():
    """测试 CLI 帮助"""
    runner = CliRunner()
    result = runner.invoke(cli, ["--help"])
    assert result.exit_code == 0
    assert "Ralph Loop Enhanced" in result.output

def test_cli_start_command():
    """测试 start 命令"""
    runner = CliRunner()
    result = runner.invoke(cli, ["start", "--help"])
    assert result.exit_code == 0
    assert "--max-iterations" in result.output
    assert "--completion-promise" in result.output

def test_cli_monitor_command():
    """测试 monitor 命令"""
    runner = CliRunner()
    result = runner.invoke(cli, ["monitor", "--help"])
    assert result.exit_code == 0
    assert "--port" in result.output
```

**Step 2: 运行测试验证失败**

```bash
pytest tests/test_cli.py -v
Expected: FAIL
```

**Step 3: 实现 CLI**

```python
# ralph-loop-enhanced/cli.py
import click
from .cli_commands import start, monitor, list, cancel

@click.group()
def cli():
    """Ralph Loop Enhanced - 增强版 Agent 循环系统"""
    pass

cli.add_command(start, "start")
cli.add_command(monitor, "monitor")
cli.add_command(list, "list")
cli.add_command(cancel, "cancel")
```

```python
# ralph-loop-enhanced/cli_commands.py
import click
from .engine.core import RalphEngine
from .state.storage import StateStorage
from .termination.engine import TerminationEngine
from .termination.conditions import MaxIterationsCondition, PromiseCondition
from .monitoring.server import create_app

@click.command()
@click.argument("prompt")
@click.option("--state-id", "-s", default=None, help="State ID (auto-generated if not provided)")
@click.option("--max-iterations", "-m", default=0, help="Max iterations (0 = infinite)")
@click.option("--completion-promise", "-p", default=None, help="Completion promise text")
@click.option("--backend", default="local", type=click.Choice(["local", "redis"]))
@click.option("--redis-url", default=None, help="Redis URL (if backend=redis)")
@click.option("--storage-path", default=".claude/ralph-states", help="Storage path")
def start(prompt, state_id, max_iterations, completion_promise, backend, redis_url, storage_path):
    """启动 Ralph Loop"""
    import uuid
    import os

    state_id = state_id or f"ralph-{uuid.uuid4().hex[:8]}"

    # 初始化组件
    storage = StateStorage(
        backend_type=backend,
        base_path=storage_path,
        redis_url=redis_url
    )

    termination = TerminationEngine([
        MaxIterationsCondition(max_iterations=max_iterations),
        PromiseCondition(promise=completion_promise) if completion_promise else None
    ])

    engine = RalphEngine(
        storage=storage,
        termination_engine=termination,
        working_dir=os.getcwd()
    )

    click.echo(f"🚀 Starting Ralph Loop: {state_id}")
    click.echo(f"📝 Prompt: {prompt}")
    click.echo(f"🔄 Max iterations: {max_iterations or 'infinite'}")
    click.echo("")

    def on_iteration(iteration, state):
        click.echo(f"  Iteration {iteration}/{state.max_iterations or '∞'}")

    def on_complete(result):
        click.echo(f"\n✅ Completed: {result.reason.value}")
        click.echo(f"   {result.message}")

    def on_error(e):
        click.echo(f"\n❌ Error: {e}")

    engine.run(
        state_id=state_id,
        prompt=prompt,
        max_iterations=max_iterations,
        completion_promise=completion_promise,
        on_iteration=on_iteration,
        on_complete=on_complete,
        on_error=on_error
    )

@click.command()
@click.option("--port", "-p", default=8080, help="Port to listen on")
@click.option("--host", "-h", default="0.0.0.0", help="Host to bind")
@click.option("--backend", default="local", type=click.Choice(["local", "redis"]))
@click.option("--storage-path", default=".claude/ralph-states", help="Storage path")
@click.option("--redis-url", default=None, help="Redis URL")
def monitor(port, host, backend, storage_path, redis_url):
    """启动监控 Web 服务器"""
    from .monitoring.server import create_app

    storage = StateStorage(
        backend_type=backend,
        base_path=storage_path,
        redis_url=redis_url
    )

    app = create_app(storage)

    click.echo(f"🌐 Starting Ralph Monitor on http://{host}:{port}")
    click.echo("Press Ctrl+C to stop")

    app.run(host=host, port=port, debug=False)

@click.command()
@click.option("--backend", default="local", type=click.Choice(["local", "redis"]))
@click.option("--storage-path", default=".claude/ralph-states", help="Storage path")
@click.option("--redis-url", default=None, help="Redis URL")
def list(backend, storage_path, redis_url):
    """列出所有活跃的 Ralph Loop"""
    storage = StateStorage(
        backend_type=backend,
        base_path=storage_path,
        redis_url=redis_url
    )

    states = storage.get_all_states()

    if not states:
        click.echo("No active Ralph loops found.")
        return

    click.echo(f"Found {len(states)} active loops:\n")

    for state_id, state in states.items():
        progress = f"{state.iteration}/{state.max_iterations}" if state.max_iterations else f"{state.iteration}/∞"
        click.echo(f"  📋 {state_id}")
        click.echo(f"     Iteration: {progress}")
        click.echo(f"     Created: {state.created_at}")
        click.echo("")

@click.command()
@click.argument("state_id")
@click.option("--backend", default="local", type=click.Choice(["local", "redis"]))
@click.option("--storage-path", default=".claude/ralph-states", help="Storage path")
@click.option("--redis-url", default=None, help="Redis URL")
def cancel(state_id, backend, storage_path, redis_url):
    """取消指定的 Ralph Loop"""
    storage = StateStorage(
        backend_type=backend,
        base_path=storage_path,
        redis_url=redis_url
    )

    success = storage.delete(state_id)

    if success:
        click.echo(f"✅ Cancelled Ralph loop: {state_id}")
    else:
        click.echo(f"❌ Ralph loop not found: {state_id}")
```

**Step 4: 运行测试验证通过**

```bash
pytest tests/test_cli.py -v
Expected: PASS
```

**Step 5: 提交**

```bash
git add tests/test_cli.py ralph-loop-enhanced/cli.py ralph-loop-enhanced/cli_commands.py
git commit -m "feat: add CLI interface for Ralph Loop Enhanced"
```

---

## 第五阶段：文档与示例

### Task 8: 编写文档和示例

**文件：**
- 创建: `ralph-loop-enhanced/README.md`
- 创建: `ralph-loop-enhanced/examples/config.yaml`
- 创建: `ralph-loop-enhanced/examples/custom_termination.py`
- 创建: `ralph-loop-enhanced/examples/middleware_notification.py`

**Step 1: 编写 README**

```markdown
# Ralph Loop Enhanced

增强版 Ralph Loop，支持外部状态存储、中间件机制、自定义终止条件、并行运行和可视化监控。

## 特性

- 🔄 **核心循环** - 增强的 Ralph Loop 引擎
- 💾 **外部状态存储** - 支持本地文件和 Redis
- 🔌 **中间件机制** - 日志、通知、指标收集
- 🎯 **自定义终止条件** - 多种终止条件组合
- ⚡ **并行运行** - 多任务并行执行
- 📊 **可视化监控** - Web 仪表板

## 安装

```bash
pip install ralph-loop-enhanced
```

## 快速开始

### 基本使用

```bash
# 启动单个 Ralph Loop
ralph-enhanced start "Build a REST API for todos" --max-iterations 20

# 启动监控面板
ralph-enhanced monitor --port 8080
```

### Python API

```python
from ralph_loop_enhanced import RalphEngine, StateStorage, TerminationEngine
from ralph_loop_enhanced.termination.conditions import MaxIterationsCondition

# 初始化
storage = StateStorage(backend_type="local")
termination = TerminationEngine([MaxIterationsCondition(max_iterations=10)])
engine = RalphEngine(storage=storage, termination_engine=termination)

# 运行
engine.run(
    state_id="my-task",
    prompt="Build a todo API",
    max_iterations=10,
    on_iteration=lambda i, s: print(f"Iteration {i}"),
    on_complete=lambda r: print(f"Done: {r.reason}")
)
```

### 自定义终止条件

```python
from ralph_loop_enhanced.termination.conditions import (
    FileExistsCondition,
    ApiResponseCondition,
    AnyCondition
)

termination = TerminationEngine([
    AnyCondition([
        FileExistsCondition(pattern="**/test_*.py"),
        ApiResponseCondition(url="http://localhost:8080/health", expected_status=200)
    ])
])
```

### 中间件

```python
from ralph_loop_enhanced.middleware.predefined import (
    LoggingMiddleware,
    NotificationMiddleware,
    MetricsMiddleware
)

middleware = MiddlewareEngine()
middleware.add_middleware(LoggingMiddleware("ralph.log").execute)
middleware.add_middleware(NotificationMiddleware(webhook_url="http://notify:9000").execute)
```

## 配置

```yaml
# config.yaml
storage:
  backend: local
  path: .claude/ralph-states
  # redis_url: redis://localhost:6379

termination:
  max_iterations: 50
  completion_promise: TASK_COMPLETE

middleware:
  logging:
    file: .claude/ralph-loop.log
  notification:
    webhook_url: http://notify:9000

monitoring:
  host: 0.0.0.0
  port: 8080
```

## 项目结构

```
ralph-loop-enhanced/
├── state/              # 状态存储
├── termination/        # 终止条件
├── middleware/         # 中间件
├── engine/             # 核心引擎
├── monitoring/         # 监控服务
├── cli.py             # CLI 入口
└── README.md
```

## 许可证

MIT
```

**Step 2: 提交**

```bash
git add ralph-loop-enhanced/README.md ralph-loop-enhanced/examples/
git commit -m "docs: add README and examples"
```

---

## 总结

完成此计划后，你将拥有一个完整的 **Ralph Loop Enhanced** 系统：

| 模块 | 功能 |
|------|------|
| `state/` | 本地/Redis 状态存储，支持锁机制 |
| `termination/` | 6 种终止条件，支持组合逻辑 |
| `middleware/` | 事件驱动中间件，预定义日志/通知/指标 |
| `engine/` | 核心引擎 + 并行执行 |
| `monitoring/` | Flask Web 服务器 + Vue 仪表板 |
| `cli.py` | 命令行界面 |

**预计代码量：** ~2000 行 Python + ~100 行 HTML/JS

---

## 执行选项

**Plan complete and saved to `docs/plans/2026-01-30-ralph-loop-enhanced.md`. Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
