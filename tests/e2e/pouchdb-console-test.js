/**
 * Playwright 测试：验证 PouchDB 依赖问题是否修复
 * 运行: bun run tests/e2e/pouchdb-console-test.js
 */

import { chromium } from 'playwright';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:1420';
const HEADLESS = process.env.HEADLESS === '1';

async function testPouchDBCompatibility() {
  console.log(`[INFO] 启动浏览器 (headless: ${HEADLESS})`);
  const browser = await chromium.launch({
    headless: HEADLESS,
    timeout: 60000
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  const errors = [];
  const warnings = [];

  // 监听控制台消息
  page.on('console', (msg) => {
    const type = msg.type();
    const text = msg.text();

    if (text.includes('React DevTools')) return;
    if (text.includes('Download the React DevTools')) return;

    if (type === 'error') {
      errors.push(text);
    } else if (type === 'warning') {
      warnings.push(text);
    }
  });

  // 监听页面错误
  page.on('pageerror', (error) => {
    errors.push(`Page Error: ${error.message}`);
  });

  try {
    console.log(`[INFO] 打开 ${BASE_URL}`);
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // 等待 React 加载
    await page.waitForTimeout(5000);

    const rootExists = await page.locator('#root').count() > 0;
    const rootContent = await page.locator('#root').innerHTML();
    const rootHasContent = rootContent.length > 100;

    console.log('\n=== 测试结果 ===');
    console.log(`root 元素存在: ${rootExists}`);
    console.log(`root 有内容: ${rootHasContent} (${rootContent.length} chars)`);

    // 关键错误检查
    const criticalErrors = errors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('404') &&
      !e.includes('manifest') &&
      !e.includes('net::ERR')
    );

    if (criticalErrors.length > 0) {
      console.log('\n🚨 关键错误:');
      criticalErrors.forEach(e => console.log(`  - ${e.substring(0, 200)}`));
    } else {
      console.log('\n✅ 无关键错误');
    }

    if (errors.length > criticalErrors.length) {
      console.log(`\n⚠️ 其他网络/资源错误: ${errors.length - criticalErrors.length} 个`);
    }

    const success = rootExists && rootHasContent && criticalErrors.length === 0;

    console.log(`\n${success ? '✅ 测试通过' : '❌ 测试失败'}`);

    return success;

  } catch (error) {
    console.error('[ERROR]', error instanceof Error ? error.message : String(error));
    return false;
  } finally {
    await browser.close();
  }
}

testPouchDBCompatibility().then(success => {
  process.exit(success ? 0 : 1);
});
