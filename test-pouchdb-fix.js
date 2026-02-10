import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleMessages = [];
  const errors = [];

  page.on('console', msg => {
    const text = msg.text();
    consoleMessages.push({ type: msg.type(), text });
    if (msg.type() === 'error') {
      errors.push(text);
    }
  });

  page.on('pageerror', error => {
    errors.push(`Page Error: ${error.message}`);
  });

  try {
    await page.goto('http://localhost:1420', { waitUntil: 'networkidle', timeout: 30000 });

    // Wait a bit for any async errors
    await page.waitForTimeout(3000);

    // Check if root has content
    const rootContent = await page.$eval('#root', el => el.innerHTML.length);
    const hasContent = rootContent > 0;

    // Check for specific PouchDB-related errors
    const pouchdbErrors = errors.filter(e =>
      e.includes('Class extends value') ||
      e.includes('PouchDB') ||
      e.includes('pouchdb') ||
      e.includes('ReferenceError')
    );

    console.log('=== 验证报告 ===');
    console.log(`页面访问: ✅ 成功`);
    console.log(`Root 内容: ${hasContent ? '✅ 有内容' : '❌ 空内容'} (${rootContent} chars)`);
    console.log(`控制台错误总数: ${errors.length}`);
    console.log(`PouchDB 相关错误: ${pouchdbErrors.length}`);

    if (pouchdbErrors.length > 0) {
      console.log('\n❌ PouchDB 错误:');
      pouchdbErrors.forEach(e => console.log(`  - ${e}`));
    }

    if (errors.length > 0 && pouchdbErrors.length === 0) {
      console.log('\n其他错误（非 PouchDB 相关）:');
      errors.forEach(e => console.log(`  - ${e}`));
    }

    if (hasContent && pouchdbErrors.length === 0) {
      console.log('\n✅ 验证通过: PouchDB 兼容性修复成功');
    } else {
      console.log('\n❌ 验证失败: 存在问题需要修复');
    }

  } catch (e) {
    console.error('测试失败:', e.message);
  }

  await browser.close();
})();
