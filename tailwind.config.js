/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        brand: {
          DEFAULT: "hsl(var(--brand) / <alpha-value>)",
          foreground: "hsl(var(--brand-foreground) / <alpha-value>)",
        },
        success: {
          DEFAULT: "hsl(var(--success) / <alpha-value>)",
          foreground: "hsl(var(--success-foreground) / <alpha-value>)",
        },
        warning: {
          DEFAULT: "hsl(var(--warning) / <alpha-value>)",
          foreground: "hsl(var(--warning-foreground) / <alpha-value>)",
        },
        // 语义化颜色 - 文字（按视觉重要性）
        primary: "hsl(var(--text-primary))",
        strong: "hsl(var(--text-strong))",
        secondary: "hsl(var(--text-secondary))",
        muted: "hsl(var(--text-muted))",
        // 语义化颜色 - 背景
        card: "hsl(var(--bg-card))",
        surface: "hsl(var(--bg-surface))",
        // 语义化颜色 - 边框
        'border-card': "hsl(var(--border-card))",
        'border-subtle': "hsl(var(--border-subtle))",
        // 语义化颜色 - 品牌色
        'brand-accent': "hsl(var(--brand-accent))",
        'brand-gradient': "var(--brand-gradient)",
        // 语义化功能性颜色 - 标签色
        'tag-info': "hsl(var(--tag-info))",
        'tag-warning': "hsl(var(--tag-warning))",
        'tag-success': "hsl(var(--tag-success))",
        'tag-error': "hsl(var(--tag-error))",
        // 语义化功能性颜色 - 用户消息气泡色
        'bubble-user-bg': "hsl(var(--bubble-user-bg))",
        'bubble-user-text': "hsl(var(--bubble-user-text))",
        'bubble-user-avatar-bg': "hsl(var(--bubble-user-avatar-bg))",
        'bubble-user-avatar-text': "hsl(var(--bubble-user-avatar-text))",
        // 语义化功能性颜色 - 遮罩
        'overlay': "hsl(var(--overlay) / <alpha-value>)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
