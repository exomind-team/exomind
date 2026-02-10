import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  const allLogs = [];

  page.on('console', msg => {
    allLogs.push({
      type: msg.type(),
      text: msg.text(),
      location: msg.location()
    });
  });

  page.on('pageerror', error => {
    allLogs.push({
      type: 'pageerror',
      text: error.message,
      stack: error.stack
    });
  });

  try {
    console.log('打开 /eventlog 页面...');
    await page.goto('http://localhost:1420/eventlog', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    console.log('尝试添加事件...');
    const inputExists = await page.$('input[placeholder*="输入"]');
    if (inputExists) {
      await inputExists.fill('测试事件');
      await inputExists.press('Enter');
      await page.waitForTimeout(3000);
    }

    console.log('\n=== 控制台日志 ===');
    allLogs.forEach(log => {
      console.log(`[${log.type}] ${log.text}`);
      if (log.stack) console.log(`Stack: ${log.stack}`);
    });

    // 查找错误
    const errors = allLogs.filter(log =>
      log.type === 'error' || log.type === 'pageerror'
    );

    const pouchdbErrors = errors.filter(e =>
      e.text.includes('Class extends value') ||
      e.text.includes('PouchDB') ||
      e.text.includes('pouchdb') ||
      e.text.includes('addEvent') ||
      e.text.includes('EventStorage')
    );

    console.log('\n=== 错误分析 ===');
    console.log(`错误总数: ${errors.length}`);
    if (pouchdbErrors.length > 0) {
      console.log('\nPouchDB/EventStorage 相关错误:');
      pouchdbErrors.forEach(e => console.log(`  - ${e.text}`));
    }

  } catch (e) {
    console.error('测试失败:', e.message);
  }

  await browser.close();
})();
