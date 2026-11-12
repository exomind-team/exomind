'''只测试桥接投影与来源合同，不启动 WinCraft 原生窗口。'''
import unittest
from exomind_next import project_snapshot


class ProjectionTests(unittest.TestCase):
    def test_valid_empty_is_idle(self) -> None:
        result = project_snapshot({'protocol': 'exomind-buffer/1', 'active': [], 'observedAt': 1000})
        self.assertEqual(result['items'][0]['value'], '没有进行中的时间块')

    def test_failure_is_not_idle(self) -> None:
        for value in (None, {}, {'protocol': 'old', 'active': []}):
            with self.assertRaises(ValueError):
                project_snapshot(value)

    def test_concurrent_blocks_remain_visible(self) -> None:
        result = project_snapshot({
            'protocol': 'exomind-buffer/1', 'observedAt': 60000,
            'active': [
                {'name': '阅读', 'startedAt': 0, 'state': 'running'},
                {'name': '休息', 'startedAt': 30000, 'state': 'running'},
            ],
        })
        self.assertEqual(len(result['items']), 2)
        self.assertIn('并发', result['status'])
        self.assertEqual(result['items'][0]['value'], '00:01:00')


if __name__ == '__main__':
    unittest.main()
