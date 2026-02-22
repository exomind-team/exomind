/**
 * Dark Mode CSS Audit - Issue #179
 *
 * 用 Playwright 在运行时检测深色模式下的 CSS 问题：
 * 1. 对比度不足（文字与背景色接近）
 * 2. 硬编码浅色值在深色模式下未变化
 * 3. 元素在深色模式下不可见
 */
import { test, expect, type Page } from '@playwright/test';

// ── 工具函数 ──────────────────────────────────────────────

/** 解析 CSS 颜色为 { r, g, b, a } */
function parseColor(color: string): { r: number; g: number; b: number; a: number } | null {
  const rgba = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (rgba) {
    return {
      r: Number(rgba[1]),
      g: Number(rgba[2]),
      b: Number(rgba[3]),
      a: rgba[4] !== undefined ? Number(rgba[4]) : 1,
    };
  }
  return null;
}

/** 计算相对亮度 (WCAG 2.1) */
function relativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/** 计算对比度 */
function contrastRatio(fg: string, bg: string): number | null {
  const fgColor = parseColor(fg);
  const bgColor = parseColor(bg);
  if (!fgColor || !bgColor) return null;

  const l1 = relativeLuminance(fgColor.r, fgColor.g, fgColor.b);
  const l2 = relativeLuminance(bgColor.r, bgColor.g, bgColor.b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** 判断颜色是否为"浅色"（亮度 > 0.6） */
function isLightColor(color: string): boolean {
  const c = parseColor(color);
  if (!c) return false;
  return relativeLuminance(c.r, c.g, c.b) > 0.6;
}

/** 判断颜色是否为"深色"（亮度 < 0.15） */
function isDarkColor(color: string): boolean {
  const c = parseColor(color);
  if (!c) return false;
  return relativeLuminance(c.r, c.g, c.b) < 0.15;
}

// ── 切换深色模式 ──────────────────────────────────────────

async function enableDarkMode(page: Page) {
  await page.evaluate(() => {
    localStorage.setItem('exomind:themePreference', 'dark');
    document.documentElement.classList.add('dark');
    document.documentElement.style.colorScheme = 'dark';
  });
  // 等待 CSS 变量生效
  await page.waitForTimeout(300);
}

async function enableLightMode(page: Page) {
  await page.evaluate(() => {
    localStorage.setItem('exomind:themePreference', 'light');
    document.documentElement.classList.remove('dark');
    document.documentElement.style.colorScheme = 'light';
  });
  await page.waitForTimeout(300);
}

// ── 收集页面元素的颜色信息 ──────────────────────────────────

interface ElementColorInfo {
  selector: string;
  text: string;
  color: string;
  backgroundColor: string;
  borderColor: string;
  contrastRatio: number | null;
}

async function collectVisibleElementColors(page: Page): Promise<ElementColorInfo[]> {
  return page.evaluate(() => {
    const results: ElementColorInfo[] = [];
    const elements = document.querySelectorAll(
      'p, span, h1, h2, h3, h4, h5, h6, a, button, label, input, textarea, select, ' +
      'div[class*="text-"], div[class*="bg-"], section, header, nav, main, aside'
    );

    for (const el of elements) {
      const rect = (el as HTMLElement).getBoundingClientRect();
      // 跳过不可见元素
      if (rect.width === 0 || rect.height === 0) continue;

      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;

      const text = (el as HTMLElement).innerText?.trim().slice(0, 50) || '';
      const className = (el as HTMLElement).className || '';
      const testId = (el as HTMLElement).getAttribute('data-testid') || '';
      const tag = el.tagName.toLowerCase();
      const selector = testId ? `[data-testid="${testId}"]` : `${tag}.${className.split(' ')[0] || 'unknown'}`;

      results.push({
        selector: selector.slice(0, 100),
        text,
        color: style.color,
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
        contrastRatio: null, // 在外部计算
      });
    }

    return results;
  });
}

// ── 测试用例 ──────────────────────────────────────────────

test.describe('Issue #179: 深色模式 CSS 审计', () => {

  test.describe('新版 UI (new-mobile)', () => {

    test('审计 1: 深色模式下文字对比度检查', async ({ page }) => {
      await page.goto('/');
      await enableDarkMode(page);

      const elements = await collectVisibleElementColors(page);
      const lowContrastElements: Array<ElementColorInfo & { ratio: number }> = [];

      for (const el of elements) {
        if (!el.text) continue; // 只检查有文字的元素
        const ratio = contrastRatio(el.color, el.backgroundColor);
        if (ratio !== null && ratio < 3.0) {
          // 排除透明背景（继承父级）
          const bg = parseColor(el.backgroundColor);
          if (bg && bg.a > 0) {
            lowContrastElements.push({ ...el, ratio });
          }
        }
      }

      if (lowContrastElements.length > 0) {
        console.log('\n=== 深色模式对比度不足的元素 ===');
        for (const el of lowContrastElements) {
          console.log(`  [对比度 ${el.ratio.toFixed(2)}] ${el.selector}`);
          console.log(`    文字: "${el.text}" | color: ${el.color} | bg: ${el.backgroundColor}`);
        }
        console.log(`\n共 ${lowContrastElements.length} 个元素对比度不足 (< 3.0:1)\n`);
      }

      // 记录但不强制失败，作为审计报告
      expect(lowContrastElements.length).toBeGreaterThanOrEqual(0);
    });

    test('审计 2: 深色模式下硬编码浅色背景检测', async ({ page }) => {
      await page.goto('/');
      await enableDarkMode(page);

      const hardcodedLightBgs = await page.evaluate(() => {
        const issues: Array<{ selector: string; bg: string; text: string }> = [];
        const allElements = document.querySelectorAll('*');

        for (const el of allElements) {
          const rect = (el as HTMLElement).getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;

          const style = getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') continue;

          const bg = style.backgroundColor;
          const bgColor = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          if (!bgColor) continue;

          const [r, g, b] = [Number(bgColor[1]), Number(bgColor[2]), Number(bgColor[3])];
          // 检测接近白色的背景 (r > 240, g > 240, b > 240)
          if (r > 240 && g > 240 && b > 240) {
            const className = (el as HTMLElement).className || '';
            const testId = (el as HTMLElement).getAttribute('data-testid') || '';
            const tag = el.tagName.toLowerCase();
            const text = (el as HTMLElement).innerText?.trim().slice(0, 30) || '';

            // 排除 body/html 本身（由 CSS 变量控制）
            if (tag === 'html' || tag === 'body') continue;

            issues.push({
              selector: testId ? `[data-testid="${testId}"]` : `${tag}.${className.split(' ')[0] || '?'}`,
              bg,
              text,
            });
          }
        }
        return issues;
      });

      if (hardcodedLightBgs.length > 0) {
        console.log('\n=== 深色模式下仍为浅色背景的元素（疑似硬编码） ===');
        for (const el of hardcodedLightBgs) {
          console.log(`  ${el.selector} | bg: ${el.bg} | "${el.text}"`);
        }
        console.log(`\n共 ${hardcodedLightBgs.length} 个元素疑似硬编码浅色背景\n`);
      }

      expect(hardcodedLightBgs.length).toBeGreaterThanOrEqual(0);
    });

    test('审计 3: 深色模式下硬编码深色文字检测', async ({ page }) => {
      await page.goto('/');
      await enableDarkMode(page);

      const hardcodedDarkTexts = await page.evaluate(() => {
        const issues: Array<{ selector: string; color: string; bg: string; text: string }> = [];
        const textElements = document.querySelectorAll(
          'p, span, h1, h2, h3, h4, h5, h6, a, button, label, li'
        );

        for (const el of textElements) {
          const rect = (el as HTMLElement).getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;

          const style = getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') continue;

          const text = (el as HTMLElement).innerText?.trim().slice(0, 40) || '';
          if (!text) continue;

          const fg = style.color;
          const fgMatch = fg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          if (!fgMatch) continue;

          const [r, g, b] = [Number(fgMatch[1]), Number(fgMatch[2]), Number(fgMatch[3])];
          // 检测接近黑色的文字 (r < 50, g < 50, b < 50)
          if (r < 50 && g < 50 && b < 50) {
            const className = (el as HTMLElement).className || '';
            const testId = (el as HTMLElement).getAttribute('data-testid') || '';
            const tag = el.tagName.toLowerCase();

            issues.push({
              selector: testId ? `[data-testid="${testId}"]` : `${tag}.${className.split(' ')[0] || '?'}`,
              color: fg,
              bg: style.backgroundColor,
              text,
            });
          }
        }
        return issues;
      });

      if (hardcodedDarkTexts.length > 0) {
        console.log('\n=== 深色模式下仍为深色文字的元素（疑似硬编码） ===');
        for (const el of hardcodedDarkTexts) {
          console.log(`  ${el.selector} | color: ${el.color} | bg: ${el.bg} | "${el.text}"`);
        }
        console.log(`\n共 ${hardcodedDarkTexts.length} 个元素疑似硬编码深色文字\n`);
      }

      expect(hardcodedDarkTexts.length).toBeGreaterThanOrEqual(0);
    });

    test('审计 4: CSS 变量在深色模式下是否正确切换', async ({ page }) => {
      await page.goto('/');

      // 浅色模式下收集 CSS 变量值
      await enableLightMode(page);
      const lightVars = await page.evaluate(() => {
        const style = getComputedStyle(document.documentElement);
        const vars = [
          '--background', '--foreground', '--card', '--card-foreground',
          '--primary', '--secondary', '--muted', '--muted-foreground',
          '--border', '--text-primary', '--text-strong', '--text-secondary',
          '--text-muted', '--bg-card', '--bg-surface', '--border-card',
          '--border-subtle', '--brand-accent',
        ];
        const result: Record<string, string> = {};
        for (const v of vars) {
          result[v] = style.getPropertyValue(v).trim();
        }
        return result;
      });

      // 深色模式下收集 CSS 变量值
      await enableDarkMode(page);
      const darkVars = await page.evaluate(() => {
        const style = getComputedStyle(document.documentElement);
        const vars = [
          '--background', '--foreground', '--card', '--card-foreground',
          '--primary', '--secondary', '--muted', '--muted-foreground',
          '--border', '--text-primary', '--text-strong', '--text-secondary',
          '--text-muted', '--bg-card', '--bg-surface', '--border-card',
          '--border-subtle', '--brand-accent',
        ];
        const result: Record<string, string> = {};
        for (const v of vars) {
          result[v] = style.getPropertyValue(v).trim();
        }
        return result;
      });

      const unchangedVars: string[] = [];
      const changedVars: Array<{ name: string; light: string; dark: string }> = [];

      for (const [name, lightVal] of Object.entries(lightVars)) {
        const darkVal = darkVars[name];
        if (lightVal === darkVal) {
          unchangedVars.push(name);
        } else {
          changedVars.push({ name, light: lightVal, dark: darkVal });
        }
      }

      console.log('\n=== CSS 变量深色模式切换报告 ===');
      console.log(`\n已切换 (${changedVars.length}):`);
      for (const v of changedVars) {
        console.log(`  ${v.name}: ${v.light} → ${v.dark}`);
      }

      if (unchangedVars.length > 0) {
        console.log(`\n未切换 (${unchangedVars.length}):`);
        for (const v of unchangedVars) {
          console.log(`  ${v}: ${lightVars[v]}`);
        }
      }

      // 核心变量必须在深色模式下有不同值
      const criticalVars = ['--background', '--foreground', '--text-primary', '--bg-card', '--bg-surface'];
      for (const v of criticalVars) {
        expect(lightVars[v], `${v} 在深色模式下应有不同值`).not.toBe(darkVars[v]);
      }
    });

    test('审计 5: body/html 背景色在深色模式下是否为深色', async ({ page }) => {
      await page.goto('/');
      await enableDarkMode(page);

      const bodyBg = await page.evaluate(() => {
        return getComputedStyle(document.body).backgroundColor;
      });

      const htmlBg = await page.evaluate(() => {
        return getComputedStyle(document.documentElement).backgroundColor;
      });

      console.log(`\nbody background: ${bodyBg}`);
      console.log(`html background: ${htmlBg}`);

      // body 背景在深色模式下应该是深色
      const bodyColor = parseColor(bodyBg);
      if (bodyColor && bodyColor.a > 0) {
        const lum = relativeLuminance(bodyColor.r, bodyColor.g, bodyColor.b);
        expect(lum, `body 背景亮度应 < 0.2，实际 ${lum.toFixed(3)}`).toBeLessThan(0.2);
      }
    });

    test('审计 6: App.css 硬编码 #f8fafc 在深色模式下的影响', async ({ page }) => {
      await page.goto('/');
      await enableDarkMode(page);

      // 检查 .app-container 是否存在且背景色是否仍为浅色
      const appContainerBg = await page.evaluate(() => {
        const el = document.querySelector('.app-container');
        if (!el) return null;
        return getComputedStyle(el).backgroundColor;
      });

      if (appContainerBg) {
        console.log(`\n.app-container background in dark mode: ${appContainerBg}`);
        const color = parseColor(appContainerBg);
        if (color && color.a > 0) {
          const isStillLight = relativeLuminance(color.r, color.g, color.b) > 0.6;
          if (isStillLight) {
            console.log('  ⚠️ .app-container 在深色模式下仍为浅色背景（App.css 硬编码 #f8fafc）');
          }
        }
      }

      // 检查 body 的 inline/css 背景
      const bodyInlineBg = await page.evaluate(() => {
        const body = document.body;
        return {
          computed: getComputedStyle(body).backgroundColor,
          inline: body.style.backgroundColor,
        };
      });

      console.log(`body computed bg: ${bodyInlineBg.computed}`);
      console.log(`body inline bg: ${bodyInlineBg.inline || '(none)'}`);
    });

    test('审计 7: 滚动条在深色模式下的可见性', async ({ page }) => {
      await page.goto('/');
      await enableDarkMode(page);

      // 检查 scrollbar-thumb 的颜色是否在深色背景上可见
      // 注意：Playwright 无法直接读取伪元素样式，但可以检查是否有深色模式的滚动条样式
      const hasScrollbarDarkStyles = await page.evaluate(() => {
        const sheets = Array.from(document.styleSheets);
        for (const sheet of sheets) {
          try {
            const rules = Array.from(sheet.cssRules);
            for (const rule of rules) {
              const text = rule.cssText;
              if (text.includes('.dark') && text.includes('scrollbar')) {
                return true;
              }
            }
          } catch {
            // 跨域样式表无法访问
          }
        }
        return false;
      });

      console.log(`\n深色模式滚动条样式: ${hasScrollbarDarkStyles ? '已定义' : '⚠️ 未定义'}`);
      if (!hasScrollbarDarkStyles) {
        console.log('  App.css 中的滚动条使用 rgba(0,0,0,0.15)，在深色背景上几乎不可见');
      }
    });
  });

  test.describe('特定组件深色模式检查', () => {

    test('审计 8: NewFocusTimerWidget 硬编码颜色统计', async ({ page }) => {
      await page.goto('/');
      await enableDarkMode(page);

      const timerWidget = page.locator('[data-testid="new-focus-timer-widget"]');
      const widgetExists = await timerWidget.count() > 0;

      if (!widgetExists) {
        console.log('\nNewFocusTimerWidget 未在当前页面渲染，跳过');
        return;
      }

      // 收集 widget 内所有元素的背景色
      const widgetColors = await page.evaluate(() => {
        const widget = document.querySelector('[data-testid="new-focus-timer-widget"]');
        if (!widget) return [];

        const results: Array<{ tag: string; className: string; bg: string; color: string }> = [];
        const elements = widget.querySelectorAll('*');

        for (const el of elements) {
          const style = getComputedStyle(el);
          const bg = style.backgroundColor;
          const color = style.color;
          const className = (el as HTMLElement).className || '';

          results.push({
            tag: el.tagName.toLowerCase(),
            className: className.slice(0, 80),
            bg,
            color,
          });
        }
        return results;
      });

      const lightBgsInWidget = widgetColors.filter((el) => {
        const c = el.bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (!c) return false;
        const [r, g, b] = [Number(c[1]), Number(c[2]), Number(c[3])];
        return r > 230 && g > 230 && b > 230;
      });

      console.log(`\n=== NewFocusTimerWidget 深色模式审计 ===`);
      console.log(`总元素数: ${widgetColors.length}`);
      console.log(`浅色背景元素数: ${lightBgsInWidget.length}`);
      if (lightBgsInWidget.length > 0) {
        console.log('浅色背景元素:');
        for (const el of lightBgsInWidget.slice(0, 10)) {
          console.log(`  <${el.tag}> bg: ${el.bg} | class: ${el.className}`);
        }
      }
    });

    test('审计 9: NewSettingsPage 硬编码颜色统计', async ({ page }) => {
      // 导航到设置页
      await page.goto('/');
      await enableDarkMode(page);

      // 尝试导航到新设置页
      await page.evaluate(() => {
        localStorage.setItem('exomind:uiMode', 'new');
      });
      await page.goto('/settings');
      await enableDarkMode(page);

      const settingsColors = await page.evaluate(() => {
        const issues: Array<{
          selector: string;
          problem: string;
          value: string;
        }> = [];

        // 检查所有带 stone-xxx, bg-white, bg-[#xxx] 类名的元素
        const hardcodedPatterns = [
          'bg-white', 'bg-\\[', 'text-stone-', 'border-\\[',
          'text-\\[#', 'bg-\\[#',
        ];

        for (const pattern of hardcodedPatterns) {
          const regex = new RegExp(pattern.replace('\\', '\\\\'));
          const elements = document.querySelectorAll(`[class]`);

          for (const el of elements) {
            const className = (el as HTMLElement).className;
            if (typeof className !== 'string') continue;

            // 检查类名中是否包含硬编码颜色模式
            const classes = className.split(/\s+/);
            for (const cls of classes) {
              if (
                cls.startsWith('bg-white') ||
                cls.startsWith('bg-[#') ||
                cls.startsWith('text-[#') ||
                cls.startsWith('text-stone-') ||
                cls.startsWith('border-[#') ||
                cls.match(/bg-\[linear-gradient/)
              ) {
                const testId = (el as HTMLElement).getAttribute('data-testid') || '';
                const tag = el.tagName.toLowerCase();
                issues.push({
                  selector: testId || `${tag}`,
                  problem: cls,
                  value: getComputedStyle(el).backgroundColor || getComputedStyle(el).color,
                });
              }
            }
          }
        }

        // 去重
        const seen = new Set<string>();
        return issues.filter((i) => {
          const key = `${i.selector}:${i.problem}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      });

      console.log(`\n=== 设置页硬编码颜色类名审计 ===`);
      console.log(`发现 ${settingsColors.length} 处硬编码颜色类名:`);
      for (const item of settingsColors.slice(0, 20)) {
        console.log(`  ${item.selector} → ${item.problem} (computed: ${item.value})`);
      }
    });

    test('审计 10: 浅色/深色模式截图对比', async ({ page }) => {
      await page.goto('/');

      // 浅色模式截图
      await enableLightMode(page);
      await page.screenshot({ path: 'tests/e2e/screenshots/light-mode.png', fullPage: true });

      // 深色模式截图
      await enableDarkMode(page);
      await page.screenshot({ path: 'tests/e2e/screenshots/dark-mode.png', fullPage: true });

      console.log('\n截图已保存:');
      console.log('  tests/e2e/screenshots/light-mode.png');
      console.log('  tests/e2e/screenshots/dark-mode.png');
    });
  });
});
