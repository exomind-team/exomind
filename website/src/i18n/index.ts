export const languages = {
    zh: "中文",
    en: "English",
};

export const defaultLang = "zh";
const runtimeBasePath = normalizeBasePath(
    import.meta.env.PUBLIC_EXOMIND_WEBSITE_BASE_PATH ?? "/",
);

export const ui = {
    zh: {
        // Nav
        "nav.features": "功能简介",
        "nav.download": "下载",
        "nav.changelog": "版本日志",
        "nav.getting_started": "快速起步",
        "nav.docs": "文档参考",
        "nav.about": "关于我们",
        "nav.repo": "仓库",
        "nav.github_repo_aria": "打开外心 GitHub 仓库",
        "theme.toggle": "切换主题",
        "theme.switch_to_dark": "切换到暗色模式",
        "theme.switch_to_light": "切换到浅色模式",
        // Hero
        "hero.title": "你的生命成长助手",
        "hero.subtitle": "用 AI 帮你记录、反思、成长。掌控自己的生命过程。",
        "hero.cta.download": "免费下载",
        "hero.cta.learn": "了解更多",
        // Features
        "features.title": "为你的成长而设计",
        "features.subtitle":
            "每一个功能都围绕一个核心：帮助你主动掌控自己的生命过程",
        "features.eventlog.title": "事件日志",
        "features.eventlog.desc":
            "像写日记一样记录生活，AI 帮你整理和回顾。不可变的事件流，真实记录你的每一天。",
        "features.timeblock.title": "时间块",
        "features.timeblock.desc":
            "专注计时器 + 能量管理。知道自己的时间花在哪里，找到最佳工作节奏。",
        "features.tasks.title": "任务系统",
        "features.tasks.desc":
            "不只是待办清单。AI 帮你拆解目标、追踪进度、回顾完成情况。",
        "features.agents.title": "AI 智能体",
        "features.agents.desc":
            "个性化的 AI 助手，理解你的习惯和目标，在合适的时机给出建议。",
        "features.privacy.title": "本地优先",
        "features.privacy.desc":
            "数据存储在你的设备上。你的生命记录，只属于你自己。",
        "features.crossplatform.title": "全平台支持",
        "features.crossplatform.desc":
            "Windows、macOS、Linux、Android。随时随地，无缝衔接。",
        "features.cta.title": "准备好了吗？",
        "features.cta.desc": "现在就开始，让 AI 陪伴你的成长之旅",
        "features.cta.download": "免费下载",
        // Download
        "download.title": "开始你的成长之旅",
        "download.subtitle": "免费下载，本地运行，数据完全属于你",
        "download.windows": "Windows",
        "download.macos": "macOS",
        "download.linux": "Linux",
        "download.android": "Android",
        "download.coming_soon": "即将推出",
        "download.version": "v0.3.x",
        "download.btn": "下载",
        "download.sysreq.title": "系统要求",
        "download.sysreq.windows": "Windows 10 及以上，64 位",
        "download.sysreq.macos": "macOS 12 Monterey 及以上",
        "download.sysreq.linux": "Ubuntu 20.04 / Fedora 36 及以上",
        "download.sysreq.android": "Android 10 及以上",
        // Changelog
        "changelog.title": "版本日志",
        "changelog.subtitle": "在一个页面里查看下载入口、发布通道与版本变更。",
        // Docs
        "docs.title": "文档",
        "docs.subtitle": "了解如何使用外心的每一个功能",
        "docs.coming_soon": "文档正在编写中，敬请期待...",
        // About
        "about.title": "关于外心",
        "about.subtitle": "我们相信，每个人都应该有能力主动掌控自己的生命过程",
        "about.mission.title": "使命",
        "about.mission.desc":
            "外心探索一个根本问题：人作为生命如何主动掌控自己的力量？我们构建工具，帮助你记录、反思、成长。",
        "about.philosophy.title": "理念",
        "about.philosophy.desc":
            "生命不是实体或状态，而是时间中持续展开的过程。外心帮你观察这个过程，理解这个过程，最终掌控这个过程。",
        "about.opensource.title": "开源",
        "about.opensource.desc":
            "外心是开源项目，代码托管在 GitHub。我们相信透明和社区的力量。",
        "about.brand.eyebrow": "命名与愿景",
        "about.brand.title": "先建立一个人的外心，再连接更多人的外心",
        "about.brand.desc":
            "外心既指一个人的外部认知与记录基础设施，也指更多人的外心逐步联结后形成的协作网络。我们先把一个人的外心建立起来，再让更多人的外心彼此连接。",
        "about.brand.line1": "先建立你的外心",
        "about.brand.line1_note": "先把记录、回顾与行动支撑起来。",
        "about.brand.line2": "再连接更多人的外心",
        "about.brand.line2_note": "把协作、陪伴与共同成长接进来。",
        "about.brand.line3": "外心也是连接外心的基础设施",
        "about.brand.line3_note": "它先服务于个人，再延伸到人与人之间。",

        // Footer
        "footer.product": "产品",
        "footer.resources": "资源",
        "footer.community": "社区",
        "footer.github": "GitHub",
        "footer.discord": "Discord",
        "footer.copyright": "© 2026 外心. 用心构建。",
    },
    en: {
        // Nav
        "nav.features": "Features",
        "nav.download": "Download",
        "nav.changelog": "Version Log",
        "nav.getting_started": "Getting Started",
        "nav.docs": "Docs",
        "nav.about": "About",
        "nav.repo": "Repository",
        "nav.github_repo_aria": "Open the ExoMind GitHub repository",
        "theme.toggle": "Toggle theme",
        "theme.switch_to_dark": "Switch to dark mode",
        "theme.switch_to_light": "Switch to light mode",
        // Hero
        "hero.title": "Your Life Growth Companion",
        "hero.subtitle":
            "AI-powered journaling, reflection, and personal growth. Take control of your life process.",
        "hero.cta.download": "Download Free",
        "hero.cta.learn": "Learn More",
        // Features
        "features.title": "Designed for Your Growth",
        "features.subtitle":
            "Every feature revolves around one core idea: helping you actively take control of your life process",
        "features.eventlog.title": "Event Log",
        "features.eventlog.desc":
            "Journal your life like an immutable event stream. AI helps you organize and reflect on every day.",
        "features.timeblock.title": "Time Blocks",
        "features.timeblock.desc":
            "Focus timer + energy management. Know where your time goes and find your optimal rhythm.",
        "features.tasks.title": "Task System",
        "features.tasks.desc":
            "More than a to-do list. AI helps break down goals, track progress, and review completions.",
        "features.agents.title": "AI Agents",
        "features.agents.desc":
            "Personalized AI assistants that understand your habits and goals, offering timely suggestions.",
        "features.privacy.title": "Local First",
        "features.privacy.desc":
            "Your data stays on your device. Your life records belong to you and only you.",
        "features.crossplatform.title": "Cross Platform",
        "features.crossplatform.desc":
            "Windows, macOS, Linux, Android. Seamless experience, anywhere, anytime.",
        "features.cta.title": "Ready to start?",
        "features.cta.desc":
            "Begin now and let AI accompany your growth journey",
        "features.cta.download": "Download Free",
        // Download
        "download.title": "Start Your Growth Journey",
        "download.subtitle":
            "Free download, runs locally, your data stays yours",
        "download.windows": "Windows",
        "download.macos": "macOS",
        "download.linux": "Linux",
        "download.android": "Android",
        "download.coming_soon": "Coming Soon",
        "download.version": "v0.3.x",
        "download.btn": "Download",
        "download.sysreq.title": "System Requirements",
        "download.sysreq.windows": "Windows 10 or later, 64-bit",
        "download.sysreq.macos": "macOS 12 Monterey or later",
        "download.sysreq.linux": "Ubuntu 20.04 / Fedora 36 or later",
        "download.sysreq.android": "Android 10 or later",
        // Changelog
        "changelog.title": "Version Log",
        "changelog.subtitle":
            "See downloads, release channels, and version changes in one place.",
        // Docs
        "docs.title": "Documentation",
        "docs.subtitle": "Learn how to use every feature of ExoMind",
        "docs.coming_soon": "Documentation is being written. Stay tuned...",
        // About
        "about.title": "About ExoMind",
        "about.subtitle":
            "We believe everyone should have the power to actively control their life process",
        "about.mission.title": "Mission",
        "about.mission.desc":
            "ExoMind explores a fundamental question: how can humans actively take control of their own power as living beings? We build tools to help you record, reflect, and grow.",
        "about.philosophy.title": "Philosophy",
        "about.philosophy.desc":
            "Life is not an entity or state, but a process that continuously unfolds in time. ExoMind helps you observe, understand, and ultimately master this process.",
        "about.opensource.title": "Open Source",
        "about.opensource.desc":
            "ExoMind is open source, hosted on GitHub. We believe in the power of transparency and community.",
        "about.brand.eyebrow": "Naming & Vision",
        "about.brand.title":
            "Start with one exomind, then connect many exominds",
        "about.brand.desc":
            "ExoMind is the singular brand for one person's cognitive infrastructure. exominds is the plural vision for many minds gradually linked into a collaborative network.",
        "about.brand.line1": "Build your exomind.",
        "about.brand.line1_note": "Start with one person's exomind.",
        "about.brand.line2": "Connect exominds.",
        "about.brand.line2_note": "Then connect more people's exominds.",
        "about.brand.line3": "ExoMind is infrastructure for exominds.",
        "about.brand.line3_note":
            "ExoMind is the infrastructure layer for exominds.",

        // Footer
        "footer.product": "Product",
        "footer.resources": "Resources",
        "footer.community": "Community",
        "footer.github": "GitHub",
        "footer.discord": "Discord",
        "footer.copyright": "© 2026 ExoMind. Built with heart.",
    },
} as const;

export function normalizeBasePath(basePath: string) {
    if (!basePath || basePath === "/") return "";
    const normalized = `/${basePath}`.replace(/\/+/g, "/").replace(/\/$/, "");
    return normalized === "/" ? "" : normalized;
}

function normalizeContentPath(path: string) {
    if (!path || path === "/") return "/";
    const normalized = `/${path}`.replace(/\/+/g, "/").replace(/\/$/, "");
    return normalized === "/" ? "/" : normalized;
}

export function stripBasePath(pathname: string, basePath = runtimeBasePath) {
    const normalizedBasePath = normalizeBasePath(basePath);
    const normalizedPathname = normalizeContentPath(pathname);
    if (!normalizedBasePath) return normalizedPathname;
    if (normalizedPathname === normalizedBasePath) return "/";
    if (normalizedPathname.startsWith(`${normalizedBasePath}/`)) {
        return normalizedPathname.slice(normalizedBasePath.length) || "/";
    }
    return normalizedPathname;
}

export function prependBasePath(path: string, basePath = runtimeBasePath) {
    const normalizedBasePath = normalizeBasePath(basePath);
    const normalizedPath = normalizeContentPath(path);
    if (!normalizedBasePath) return normalizedPath;
    return normalizedPath === "/"
        ? `${normalizedBasePath}/`
        : `${normalizedBasePath}${normalizedPath}`;
}

function stripLangPrefix(path: string) {
    const normalizedPath = normalizeContentPath(path);
    const segments = normalizedPath.split("/");
    const lang = segments[1];
    if (!(lang in languages)) return normalizedPath;
    const remainder = `/${segments.slice(2).join("/")}`
        .replace(/\/+/g, "/")
        .replace(/\/$/, "");
    return remainder === "" ? "/" : remainder;
}

export function getLangFromUrl(url: URL, basePath = runtimeBasePath) {
    const strippedPathname = stripBasePath(url.pathname, basePath);
    const [, lang] = strippedPathname.split("/");
    if (lang in languages) return lang as keyof typeof languages;
    return defaultLang;
}

export function useTranslations(lang: keyof typeof ui) {
    return function t(key: keyof (typeof ui)[typeof defaultLang]) {
        return ui[lang][key] || ui[defaultLang][key];
    };
}

export function getLocalizedPath(
    path: string,
    lang: string,
    basePath = runtimeBasePath,
) {
    const normalizedPath = normalizeContentPath(path);
    const localizedPath =
        lang === defaultLang
            ? normalizedPath
            : normalizedPath === "/"
              ? `/${lang}/`
              : `/${lang}${normalizedPath}`;
    return prependBasePath(localizedPath, basePath);
}

export function getLanguageSwitchPath(
    pathname: string,
    targetLang: string,
    basePath = runtimeBasePath,
) {
    const strippedPathname = stripBasePath(pathname, basePath);
    const localizedContentPath = stripLangPrefix(strippedPathname);
    return getLocalizedPath(localizedContentPath, targetLang, basePath);
}
