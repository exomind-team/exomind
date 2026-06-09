import { getLocalizedPath } from "../i18n";

export type DocsLocale = "zh" | "en";
export type DocsSectionId = "start" | "workflows" | "support";
export type DocSlug =
  | "getting-started"
  | "capture"
  | "voice-input"
  | "time-blocks"
  | "tasks"
  | "device-pairing"
  | "faq";

export interface DocsStep {
  label?: string;
  title: string;
  description?: string;
  actions?: string[];
  outcome?: string;
}

export interface DocsFaq {
  question: string;
  answer: string;
}

export interface DocsSectionContent {
  title: string;
  lead?: string;
  paragraphs?: string[];
  bullets?: string[];
  steps?: DocsStep[];
  faqs?: DocsFaq[];
  note?: string;
}

export interface DocsPage {
  slug: DocSlug;
  title: string;
  description: string;
  summary: string;
  sectionId: DocsSectionId;
  eyebrow: string;
  heroLead: string;
  badge?: string;
  sections: DocsSectionContent[];
  related?: DocSlug[];
}

export interface DocsSectionMeta {
  id: DocsSectionId;
  title: string;
  description: string;
}

export interface DocsResource {
  tag: string;
  title: string;
  description: string;
  href: string;
  cta: string;
  external?: boolean;
}

const githubRepoUrl = "https://github.com/exomind-team/exomind";
const hiddenDocsSlugs: DocSlug[] = ["getting-started"];

function isPublishedDocsPage(page: DocsPage) {
  return !hiddenDocsSlugs.includes(page.slug);
}

const docsSections: Record<DocsLocale, DocsSectionMeta[]> = {
  zh: [
    {
      id: "start",
      title: "开始使用",
      description: "第一次使用时，先完成起步和最基本的确认。",
    },
    {
      id: "workflows",
      title: "主要功能",
      description: "已经开始用了，就按眼前要做的事找页面。",
    },
    {
      id: "support",
      title: "排障与支持",
      description: "卡住、看版本说明或回到项目入口时，从这里继续。",
    },
  ],
  en: [
    {
      id: "start",
      title: "Start Here",
      description: "Begin with the shortest path to your first real use.",
    },
    {
      id: "workflows",
      title: "Core Workflows",
      description: "Jump to the task you need instead of rereading everything.",
    },
    {
      id: "support",
      title: "Troubleshooting & Support",
      description: "When you are blocked or need release context, continue here.",
    },
  ],
};

const docsPages: Record<DocsLocale, DocsPage[]> = {
  zh: [
    {
      slug: "getting-started",
      title: "起步",
      description: "第一次使用外心时，从这里完成 3 分钟上手和基础排障。",
      summary: "先记一条、开一个时间块，或者直接建一个任务。",
      sectionId: "start",
      eyebrow: "Getting Started / 起步",
      heroLead:
        "第一次打开外心，不用先研究全部功能。先选你现在最接近的一步：记一条、开一个时间块，或者直接建一个任务。",
      badge: "第一站",
      sections: [
        {
          title: "先完成这三步",
          lead: "第一天只要完成下面三步，你就已经不再从空白开始。",
          steps: [
            {
              label: "01",
              title: "写下第一条事件",
              description:
                "不要先想分类，也不要先整理结构。把你此刻在做什么写进去就够了。",
              actions: [
                "打开外心后，先在事件输入框里写一句你现在正在做的事。",
                "写碎片也可以，例如“在整理今天的任务”或“刚开完会，脑子有点乱”。",
                "写完就发送，不需要等到“足够完整”。",
              ],
              outcome: "做到这里，你已经不是在对着空白页面发愣了。",
            },
            {
              label: "02",
              title: "试一次语音输入",
              description:
                "当你不想打字时，语音输入是把念头留住的最快方法。",
              actions: [
                "点击麦克风按钮开始录音，再点一次停止。",
                "等识别完成后，检查文字是否进入输入框。",
                "如果内容没问题，就直接发送，让它也进入事件日志。",
              ],
              outcome: "做到这里，你已经能在忙的时候把念头及时留下来。",
            },
            {
              label: "03",
              title: "开始第一个时间块",
              description:
                "你不用先学会复杂统计，只要先开始一段真实的专注时间。",
              actions: [
                "在时间块名称输入框里填一个你接下来要专注的标题。",
                "开始后先去做事，结束时补一句身心反馈，例如“推进顺利，但中途分心两次”。",
                "不用追求完美统计，先让系统开始积累属于你的节奏数据。",
              ],
              outcome: "做到这里，你已经开始看见自己的时间是怎么被用掉的。",
            },
          ],
        },
        {
          title: "做完以后，下一步看什么",
          lead: "第一次使用之后，不用继续在一页里来回找。按你现在最想推进的功能跳到对应文档就够了。",
          bullets: [
            "如果你只是想更稳定地留住念头，继续看“记录”。",
            "如果你经常在路上、开会后或来不及打字时记录，继续看“语音输入”。",
            "如果你想弄清楚时间到底去哪了，继续看“时间块”。",
            "如果你已经知道现在要推进什么，继续看“任务系统”。",
            "如果你准备把另一台设备也接进来，继续看“设备配对”。",
          ],
          note: "卡住时，不要先去高级设置，先看 FAQ。",
        },
      ],
      related: ["capture", "time-blocks", "tasks", "device-pairing", "faq"],
    },
    {
      slug: "capture",
      title: "记录",
      description: "知道什么时候该记、怎么记，以及什么叫记成功了。",
      summary: "想到什么先留下来，不要先判断它值不值得。",
      sectionId: "workflows",
      eyebrow: "Capture / 记录",
      heroLead:
        "外心里的记录不是给“整理好了的想法”准备的，而是给那些马上就会消失的东西准备的。",
      sections: [
        {
          title: "什么时候应该先记下来",
          paragraphs: [
            "当你脑子里刚冒出一个念头、刚结束一场会、刚发现自己状态不对，或者突然意识到某件事该跟进时，都应该先记。",
            "不要先判断它是不是任务、是不是日记、是不是值得保存。先留下来，再决定要不要整理。",
          ],
        },
        {
          title: "最简单的写法",
          lead: "你不需要把记录写得像正式文档。只要自己回头看得懂，就够了。",
          bullets: [
            "一句话就够，例如“下午两点后明显分心，先去走十分钟”。",
            "碎片也可以，例如“和 A 讨论合作，感觉方向对了，但范围太散”。",
            "如果你知道后面还会补，就先发出去，不要因为想写完整而拖住自己。",
          ],
        },
        {
          title: "怎么判断这条记录已经起作用了",
          bullets: [
            "你能在时间线上重新看到它。",
            "你不需要靠大脑硬记“我刚刚想到什么”。",
            "当你晚点回来时，仍然知道这条记录想表达什么。",
          ],
          note: "记录的第一目标不是优雅，而是不丢。",
        },
      ],
      related: ["voice-input", "time-blocks", "faq"],
    },
    {
      slug: "voice-input",
      title: "语音输入",
      description: "不想打字时，怎样用语音把念头及时留下来。",
      summary: "边走边记、开完会马上记、手上没空时，优先用语音输入。",
      sectionId: "workflows",
      eyebrow: "Voice Input / 语音输入",
      heroLead:
        "语音输入最有价值的场景，不是替代键盘，而是替代“等我有空再补”。",
      sections: [
        {
          title: "什么时候优先用语音",
          bullets: [
            "你正在走路、整理东西、切换场景，不方便打字。",
            "你刚开完会，脑子里还有一团还没整理好的东西。",
            "你知道这个念头十分钟后大概率就会消失。",
          ],
        },
        {
          title: "一次标准的语音输入流程",
          steps: [
            {
              label: "01",
              title: "开始录音",
              description: "点击麦克风后，先把话说完，不用边说边修辞。",
            },
            {
              label: "02",
              title: "确认识别结果",
              description: "看一眼文字有没有明显错误，特别是人名、时间和关键动作。",
            },
            {
              label: "03",
              title: "直接发送",
              description: "如果大意没问题，就让它进入事件日志，不要卡在“还想润一下”。",
            },
          ],
        },
        {
          title: "如果语音输入不好用，先检查什么",
          bullets: [
            "先看麦克风权限是不是已经打开。",
            "先确认你不是在一个完全离线、又依赖在线识别的环境里。",
            "如果识别结果大意是对的，就先记下来，细修不是第一优先级。",
          ],
          note: "如果权限被拒绝或识别始终失败，直接去 FAQ。",
        },
      ],
      related: ["capture", "faq"],
    },
    {
      slug: "time-blocks",
      title: "时间块",
      description: "把当前这一小步接进真实可执行的时段，并在结束后留下反馈。",
      summary: "时间块把任务接进真实时段，让开始、投入和结束反馈落在同一条线程里。",
      sectionId: "workflows",
      eyebrow: "Time Blocks / 时间块",
      heroLead:
        "时间块不是单独存在的专注计时器，而是把当前任务接进真实时段、开始执行并留下反馈的执行容器。",
      sections: [
        {
          title: "什么时候开一个时间块",
          paragraphs: [
            "当你准备专注处理一件事，而且希望回头知道这段时间到底花得值不值时，就可以开一个时间块。",
            "它不要求你先把计划想得很细，只要求你先开始一段真实的投入。",
          ],
        },
        {
          title: "最小可用流程",
          steps: [
            {
              label: "01",
              title: "给它一个短标题",
              description: "标题只要能让你稍后回想起这段时间在做什么就行。",
            },
            {
              label: "02",
              title: "先做事",
              description: "开始后，把注意力放回任务本身，不要一直盯着计时器。",
            },
            {
              label: "03",
              title: "结束时补一句反馈",
              description: "例如“推进顺利，但中途被消息打断三次”或“做完了，但比预期更耗神”。",
              outcome: "这句反馈会让回看时不只剩时长，还能看见状态。",
            },
          ],
        },
        {
          title: "怎么让时间块真的有用",
          bullets: [
            "不要一次开太多块。先让每一块都有真实起止和反馈。",
            "如果你已经知道现在要推进什么，就让时间块直接承接那一步任务。",
            "不要把它当成绩效工具，先把它当自我观察工具。",
            "连续留下几次时间块后，你会比只看待办更快看到自己的工作节奏。",
          ],
        },
      ],
      related: ["tasks", "capture", "device-pairing", "faq"],
    },
    {
      slug: "tasks",
      title: "任务系统",
      description: "把已经开始的动作编排成可继续推进的任务结构，而不是堆成平面待办。",
      summary: "任务系统让你知道现在最值得推进什么，以及做完之后下一步接到哪里。",
      sectionId: "workflows",
      eyebrow: "Task System / 任务系统",
      heroLead:
        "任务系统不是附带待办，而是把当前根节点、任务关系和下一步行动组织到同一条工作线程里。",
      sections: [
        {
          title: "任务系统在这里是用来做什么的",
          paragraphs: [
            "当你已经知道自己要推进什么，但不想把目标、依赖和状态散落在脑子里、便签里和待办列表里时，就该直接建任务。",
            "它负责把模糊目标收敛成此刻最值得推进的一步，并让你知道做完之后该接到哪里，而不是重新整理一遍。",
          ],
        },
        {
          title: "什么时候直接建一个任务",
          bullets: [
            "你已经知道要推进什么。",
            "你想直接进入行动组织，而不是先记一条再慢慢整理。",
            "创建任务没有前置依赖；你不需要先写记录，也不需要先开时间块。",
          ],
          note: "在起步页里，任务系统应该是零依赖入口，而不是其他入口的子步骤。",
        },
        {
          title: "一个任务最小可用流程",
          steps: [
            {
              label: "01",
              title: "先建一个清楚的当前任务",
              description:
                "标题先写成你现在真的要推进的动作，不必一开始就展开成完整计划。",
            },
            {
              label: "02",
              title: "补上下一步、描述或关系",
              description:
                "哪怕只补一句“先完成什么”，也比把任务留在一个空名字里更有用。",
            },
            {
              label: "03",
              title: "准备好了就接一个时间块",
              description:
                "当你已经知道现在该做什么，就让时间块承接这一小步，开始真实执行。",
              outcome:
                "这时任务不再是模糊目标，而是已经连上下一步行动的工作线程。",
            },
          ],
        },
        {
          title: "任务、时间块和记录怎么配合",
          bullets: [
            "任务系统管的是“现在最值得推进什么”。",
            "时间块管的是“这一小步什么时候开始做、做了多久”。",
            "记录负责把执行过程里的线索、反馈和总结留下来，方便继续推进。",
          ],
          note:
            "可以记成一句话：事件先留下线索，时间块负责开始，任务把动作组织成可继续推进的结构。",
        },
        {
          title: "怎么判断任务系统已经起作用了",
          bullets: [
            "你一打开外心，就知道现在最该推进哪个任务。",
            "做完一小步后，系统里还能看见下一步，而不是重新从零整理。",
            "任务之间的关系开始变清楚，不再只有一列会越堆越长的清单。",
          ],
        },
      ],
      related: ["time-blocks", "capture", "faq"],
    },
    {
      slug: "device-pairing",
      title: "设备配对",
      description: "把另一台设备接进来时，走什么路径最稳，卡住时先查什么。",
      summary: "正常使用下，先配对，再验证互通，不要一上来就手填 host:port。",
      sectionId: "workflows",
      eyebrow: "Device Pairing / 设备配对",
      heroLead:
        "设备配对最常见的问题，不是操作太少，而是太早走进高级路径。普通使用时，先走默认主路径。",
      sections: [
        {
          title: "推荐主路径",
          bullets: [
            "进入“网络 -> 设备”。",
            "让两台设备都在同一个 Wi-Fi 或局域网里。",
            "先发起配对，再做一次互通验证。",
          ],
          note: "如果你只是把自己的另一台设备接进来，不需要一开始就手填 host:port。",
        },
        {
          title: "看不到待配对设备时",
          bullets: [
            "先确认两台设备是不是在同一个网络里。",
            "回到“网络 -> 设备”页，刷新一次或重新进入页面。",
            "如果仍然看不到，再重新发起配对，而不是先跳高级模式。",
          ],
        },
        {
          title: "PIN 成功但没有“已验证互通”时",
          paragraphs: [
            "这通常说明配对动作已经通过，但链路验证还没完成。",
            "先点击一次“测试互联”，等几秒再看状态。如果还是失败，就检查两台设备是不是都在线、是不是刚切换过网络。",
          ],
        },
      ],
      related: ["faq", "getting-started"],
    },
    {
      slug: "faq",
      title: "常见问题 / 排障",
      description: "当记录、语音输入、时间块或设备配对卡住时，先看这组问题。",
      summary: "先回答那些最容易让人停下来的问题。",
      sectionId: "support",
      eyebrow: "FAQ / 常见问题与排障",
      heroLead:
        "下面这些问题不是知识库索引，而是最容易阻止你继续用下去的地方。",
      sections: [
        {
          title: "最常见的五个问题",
          faqs: [
            {
              question: "没有网的时候还能用吗？",
              answer:
                "可以。写记录、看历史、本地数据都不该因为断网停下来。通常需要联网的是语音识别、某些在线能力或跨设备连接。所以没网时，先把事情记下来；等网络恢复后，再处理需要联网的部分。",
            },
            {
              question: "看不到待配对设备怎么办？",
              answer:
                "先确认两台设备在同一个 Wi-Fi 或局域网里，再到两边的“网络 -> 设备”页面刷新一次。还看不到时，退出再进入设备页，或者重试配对。普通使用下，不需要一开始就手动填写 host:port。",
            },
            {
              question: "PIN 输入成功，但还是没有“已验证互通”怎么办？",
              answer:
                "这通常说明配对已经通过，但连接测试还没成功。先点一次“测试互联”，等几秒看状态是否恢复；如果还是失败，就检查两台设备是不是都在线、是不是刚切换过网络。只要其中一台掉线，验证就会失败。",
            },
            {
              question: "麦克风权限被拒绝怎么办？",
              answer:
                "先去系统或浏览器权限里把麦克风打开，再回到页面刷新重试。桌面 Chrome 可以从地址栏左侧的锁图标进入权限设置；Android 则优先检查系统里的 Chrome 权限。先把权限打通，再判断是不是识别服务问题。",
            },
            {
              question: "什么时候才需要“高级 / 兼容模式”？",
              answer:
                "只有当你明确要连接外部 RT、手动填写 host:port，或者正在做调试时，才需要看“高级 / 兼容模式”。如果你只是想正常记录、配对、回看，先走普通路径就够了。",
            },
          ],
        },
      ],
      related: ["voice-input", "device-pairing", "getting-started"],
    },
  ],
  en: [
    {
      slug: "getting-started",
      title: "Getting Started",
      description:
        "Start using ExoMind with a short first-use path and the most important troubleshooting answers.",
      summary:
        "Write one note, start one time block, or create one task before anything else.",
      sectionId: "start",
      eyebrow: "Getting Started",
      heroLead:
        "The first time you open ExoMind, do not learn everything at once. Pick the closest next move first: write one line, start one time block, or create one task.",
      badge: "First Stop",
      sections: [
        {
          title: "Finish these three steps first",
          lead: "If you finish the steps below on day one, you are no longer starting from blank.",
          steps: [
            {
              label: "01",
              title: "Write your first event",
              description:
                "Do not worry about categories or structure yet. Just write what you are doing right now.",
              actions: [
                "Open ExoMind and type one sentence into the event input.",
                "Fragments are fine too, such as “sorting out today’s tasks” or “just finished a meeting, mind still messy”.",
                "Send it right away. Do not wait until it feels complete.",
              ],
              outcome: "At this point, you are no longer staring at a blank screen.",
            },
            {
              label: "02",
              title: "Try voice input once",
              description:
                "When typing feels too slow, voice input is the fastest way to keep a thought from disappearing.",
              actions: [
                "Tap the microphone to start recording, then tap again to stop.",
                "Wait for transcription and check that the text appears in the input box.",
                "If it looks right, send it straight into your event log.",
              ],
              outcome: "At this point, you can keep a thought while you are still in motion.",
            },
            {
              label: "03",
              title: "Start your first time block",
              description:
                "You do not need advanced stats yet. You only need one real block of focused time.",
              actions: [
                "Give the time block a short title for what you are about to focus on.",
                "Start it, do the work, then add one short reflection when you stop.",
                "Do not chase perfect tracking. Let the system begin to learn your rhythm first.",
              ],
              outcome: "At this point, you have started to see where your time actually goes.",
            },
          ],
        },
        {
          title: "What to read next",
          lead: "Once you have started, stop bouncing around the same page and jump to the part you want to push forward next.",
          bullets: [
            "If your main goal is to keep thoughts from disappearing, continue with Capture.",
            "If you often need to record something without typing, continue with Voice Input.",
            "If you want to understand where your day actually went, continue with Time Blocks.",
            "If you already know what should move next, continue with Task System.",
            "If you are bringing in another device, continue with Device Pairing.",
          ],
          note: "If something blocks you, go to FAQ before diving into advanced settings.",
        },
      ],
      related: ["capture", "time-blocks", "tasks", "device-pairing", "faq"],
    },
    {
      slug: "capture",
      title: "Capture",
      description: "Know when to write something down, how little is enough, and what counts as a successful note.",
      summary: "Capture first. Do not judge whether the thought is worth keeping before it is safe.",
      sectionId: "workflows",
      eyebrow: "Capture",
      heroLead:
        "ExoMind is not only for fully-formed thoughts. It is most useful when something would otherwise disappear in minutes.",
      sections: [
        {
          title: "When you should capture something first",
          paragraphs: [
            "Capture when a thought just appeared, when a meeting ended, when you notice your state changing, or when you realize something should be followed up.",
            "Do not decide first whether it is a task, a journal entry, or worth saving. Keep it first, sort it later.",
          ],
        },
        {
          title: "What the smallest useful note looks like",
          lead: "Your note does not need to look polished. It only needs to make sense when you come back.",
          bullets: [
            "One sentence is enough, such as “lost focus after 2pm, take a ten-minute walk first.”",
            "Fragments are fine, such as “talked to A about the partnership, direction feels right, scope still too wide.”",
            "If you know you will expand it later, send it first instead of waiting for a cleaner version.",
          ],
        },
        {
          title: "How to tell the note is already helping",
          bullets: [
            "You can see it again on the timeline.",
            "You no longer need to hold the thought in your head by force.",
            "When you return later, you still know what it meant.",
          ],
          note: "The first goal of capture is not elegance. It is not losing the thing.",
        },
      ],
      related: ["voice-input", "time-blocks", "faq"],
    },
    {
      slug: "voice-input",
      title: "Voice Input",
      description: "Use voice when typing is too slow and the thought needs to survive right now.",
      summary: "Use voice input when the cost of waiting is higher than the cost of speaking imperfectly.",
      sectionId: "workflows",
      eyebrow: "Voice Input",
      heroLead:
        "Voice input is most valuable when it replaces “I’ll write it down later” and later never comes.",
      sections: [
        {
          title: "When voice should be your first choice",
          bullets: [
            "You are walking, moving, or switching contexts and typing would interrupt you.",
            "A meeting just ended and the thought is still half-formed.",
            "You know the idea will probably be gone ten minutes later.",
          ],
        },
        {
          title: "A normal voice-input flow",
          steps: [
            {
              label: "01",
              title: "Start recording",
              description: "Say the thought through first. Do not waste the first pass polishing the wording.",
            },
            {
              label: "02",
              title: "Check the transcription",
              description: "Look for obvious mistakes, especially names, times, and the main action.",
            },
            {
              label: "03",
              title: "Send it",
              description: "If the meaning is correct, let it into the log instead of waiting for a cleaner version.",
            },
          ],
        },
        {
          title: "If voice input feels unreliable, check this first",
          bullets: [
            "Check microphone permission before anything else.",
            "Make sure you are not fully offline while depending on an online speech service.",
            "If the meaning is right, capture first. Perfect wording is not the first priority.",
          ],
          note: "If permission or recognition keeps failing, go straight to FAQ.",
        },
      ],
      related: ["capture", "faq"],
    },
    {
      slug: "time-blocks",
      title: "Time Blocks",
      description: "Place the next concrete step into a real stretch of time and leave feedback you can learn from later.",
      summary: "Time blocks connect a task to a real execution window instead of acting like a standalone timer.",
      sectionId: "workflows",
      eyebrow: "Time Blocks",
      heroLead:
        "A time block is not a timer sitting by itself. It is the execution container that lets a task actually begin in time.",
      sections: [
        {
          title: "When to start a time block",
          paragraphs: [
            "Start one when you are about to focus on something real and want to know later whether the time felt well spent.",
            "It does not require a perfect plan. It only requires a real stretch of attention.",
          ],
        },
        {
          title: "The smallest useful flow",
          steps: [
            {
              label: "01",
              title: "Give it a short title",
              description: "The title only needs to help future-you remember what the block was for.",
            },
            {
              label: "02",
              title: "Do the work",
              description: "Once it starts, put your attention back on the task instead of watching the timer.",
            },
            {
              label: "03",
              title: "Add one line of feedback at the end",
              description: "For example: “steady progress, but got interrupted three times” or “finished it, but it cost more energy than expected.”",
              outcome: "That one line gives you something to learn from later, not just a duration.",
            },
          ],
        },
        {
          title: "How to make time blocks useful",
          bullets: [
            "Do not open too many. Make each one real first.",
            "If you already know the next thing to push forward, let the time block inherit that step directly.",
            "Do not treat them as a performance tool before they become an observation tool.",
            "After a few honest blocks, your rhythm becomes easier to see than if you only watch a task list.",
          ],
        },
      ],
      related: ["tasks", "capture", "device-pairing", "faq"],
    },
    {
      slug: "tasks",
      title: "Task System",
      description: "Turn work that has already started into a structure that can keep moving instead of a flat to-do list.",
      summary: "The task system helps you see what is worth pushing now and where the next step goes after this one.",
      sectionId: "workflows",
      eyebrow: "Task System",
      heroLead:
        "The task system is not an extra checklist. It is the layer that keeps the current root, relationships, and next action inside one working thread.",
      sections: [
        {
          title: "What the task system is here to do",
          paragraphs: [
            "Use it when you already know what needs to move, but do not want the goal, dependency, and status to scatter across your head, loose notes, and a flat task list.",
            "It turns a vague goal into the next step worth pushing now, and it helps you see where the work continues instead of forcing you to reorganize from zero.",
          ],
        },
        {
          title: "When to create a task directly",
          bullets: [
            "You already know what needs to move.",
            "You want to organize action directly instead of capturing something first and sorting it later.",
            "Task creation has no prerequisite. You do not need to write an event or start a time block first.",
          ],
          note: "On the getting-started page, task creation should stay a zero-dependency entry instead of a sub-step under another card.",
        },
        {
          title: "The smallest useful task flow",
          steps: [
            {
              label: "01",
              title: "Create one clear current task",
              description:
                "Write the title as the real action you want to push right now. It does not need to become a full plan on the first pass.",
            },
            {
              label: "02",
              title: "Add the next step, description, or relationship",
              description:
                "Even one short line about what has to happen next is better than leaving the task as an empty label.",
            },
            {
              label: "03",
              title: "Attach a time block when you are ready",
              description:
                "Once you know what should move now, let a time block carry that step into a real execution window.",
              outcome:
                "At that point the task is no longer vague. It is a working thread with a live next action.",
            },
          ],
        },
        {
          title: "How tasks, time blocks, and capture work together",
          bullets: [
            "The task system answers what is worth pushing now.",
            "Time blocks answer when that step begins and how the execution actually went.",
            "Capture keeps the clues, feedback, and review notes that help the thread continue.",
          ],
          note:
            "A simple way to remember it: events keep the clues, time blocks begin the work, and tasks organize the action into something that can continue.",
        },
        {
          title: "How to tell the task system is already helping",
          bullets: [
            "You can open ExoMind and immediately see which task should move now.",
            "After one step finishes, the next step is still visible instead of forcing a full reset.",
            "Relationships between tasks become clearer than one column of items that only grows longer.",
          ],
        },
      ],
      related: ["time-blocks", "capture", "faq"],
    },
    {
      slug: "device-pairing",
      title: "Device Pairing",
      description: "Pair another device through the normal path first, then troubleshoot only if you need to.",
      summary: "For normal use, pair first and verify second. Do not start with host:port by hand.",
      sectionId: "workflows",
      eyebrow: "Device Pairing",
      heroLead:
        "The most common pairing problem is not doing too little. It is going into advanced setup too early.",
      sections: [
        {
          title: "Recommended normal path",
          bullets: [
            "Go to Network -> Devices.",
            "Make sure both devices are on the same Wi-Fi or local network.",
            "Start pairing first, then run a connection check.",
          ],
          note: "If you are only bringing in your own second device, you usually do not need host:port at all.",
        },
        {
          title: "If you cannot see the device you want to pair",
          bullets: [
            "First confirm both devices are on the same network.",
            "Return to Network -> Devices and refresh or reopen the page.",
            "If it still does not appear, retry pairing before touching advanced mode.",
          ],
        },
        {
          title: "If the PIN succeeds but verification does not",
          paragraphs: [
            "That usually means pairing itself succeeded but the connectivity test did not.",
            "Tap Test Connection once and wait a few seconds. If it still fails, confirm that both devices are online and that the network has not just changed.",
          ],
        },
      ],
      related: ["faq", "getting-started"],
    },
    {
      slug: "faq",
      title: "FAQ / Troubleshooting",
      description: "Start with the questions most likely to stop you from continuing.",
      summary: "These are not general knowledge-base entries. They are the issues most likely to make you quit early.",
      sectionId: "support",
      eyebrow: "FAQ / Troubleshooting",
      heroLead:
        "These questions matter because they are usually the exact points where people stop using the product.",
      sections: [
        {
          title: "The five most common blockers",
          faqs: [
            {
              question: "Can I still use ExoMind without internet?",
              answer:
                "Yes. Writing notes, reviewing history, and keeping local data should not stop when the network does. Internet is usually only needed for speech recognition, some online capabilities, or cross-device connectivity. If you need to remember something now, write it first and handle the online part later.",
            },
            {
              question: "What if I cannot see the device I want to pair?",
              answer:
                "First confirm that both devices are on the same Wi-Fi or local network. Then open Network -> Devices on both sides and refresh once. If the device still does not appear, leave the page and re-enter it or retry pairing. In normal use, you should not need to fill in host:port manually.",
            },
            {
              question: "The PIN was accepted, but it still does not say connected. What now?",
              answer:
                "That usually means pairing succeeded, but the connectivity check did not. Tap Test Connection once and wait a few seconds. If it still fails, make sure both devices are online and still on the same network. If either side drops off the network, verification will fail.",
            },
            {
              question: "What if microphone permission is denied?",
              answer:
                "Enable microphone access in your system or browser permissions, then refresh and try again. In desktop Chrome, you can use the lock icon next to the address bar. On Android, check Chrome’s app permissions first. Fix permission access before assuming the speech service is broken.",
            },
            {
              question: "When do I actually need advanced / compatibility mode?",
              answer:
                "Only use it when you clearly know that you need an external RT endpoint, a manual host:port, or a debugging setup. If you only want to record, pair devices, and review your own data, stay on the normal path first.",
            },
          ],
        },
      ],
      related: ["voice-input", "device-pairing", "getting-started"],
    },
  ],
};

const docsResources: Record<DocsLocale, DocsResource[]> = {
  zh: [
    {
      tag: "安装",
      title: "版本日志与下载",
      description: "查看平台下载入口、发布通道和当前版本边界。",
      href: getLocalizedPath("/changelog", "zh"),
      cta: "查看版本日志",
    },
    {
      tag: "版本",
      title: "版本变更",
      description: "看当前版本修了什么、有哪些变化，以及哪些部分仍在完善。",
      href: getLocalizedPath("/changelog", "zh"),
      cta: "看版本记录",
    },
    {
      tag: "背景",
      title: "为什么是外心",
      description: "了解外心为什么强调记录、时间、本地优先和个人节奏。",
      href: getLocalizedPath("/about", "zh"),
      cta: "了解背景",
    },
    {
      tag: "开源",
      title: "GitHub 仓库",
      description: "查看源码、Issue、发布记录和项目的公开进展。",
      href: githubRepoUrl,
      cta: "打开 GitHub",
      external: true,
    },
  ],
  en: [
    {
      tag: "Install",
      title: "Version Log & Downloads",
      description: "See platform downloads, release channels, and current release boundaries.",
      href: getLocalizedPath("/changelog", "en"),
      cta: "Open version log",
    },
    {
      tag: "Version",
      title: "Version Changes",
      description: "See what changed in the current release and what boundaries still exist.",
      href: getLocalizedPath("/changelog", "en"),
      cta: "Read version log",
    },
    {
      tag: "Background",
      title: "Why ExoMind",
      description: "Learn why ExoMind centers around capture, time, local-first data, and personal rhythm.",
      href: getLocalizedPath("/about", "en"),
      cta: "Read background",
    },
    {
      tag: "Open Source",
      title: "GitHub Repository",
      description: "Browse the source code, issues, release history, and public project progress.",
      href: githubRepoUrl,
      cta: "Open GitHub",
      external: true,
    },
  ],
};

export function getDocsPages(lang: DocsLocale) {
  return docsPages[lang].filter(isPublishedDocsPage);
}

export function getDocsPage(lang: DocsLocale, slug: string) {
  return docsPages[lang].find(
    (page) => page.slug === slug && isPublishedDocsPage(page),
  );
}

export function getDocsSections(lang: DocsLocale) {
  const pages = getDocsPages(lang);

  return docsSections[lang]
    .map((section) => ({
      ...section,
      items: pages.filter((page) => page.sectionId === section.id),
    }))
    .filter((section) => section.items.length > 0);
}

export function getDocsResources(lang: DocsLocale) {
  return docsResources[lang];
}

export function getDocsIndexPath(lang: DocsLocale) {
  return getLocalizedPath("/docs", lang);
}

export function getDocsPagePath(lang: DocsLocale, slug: DocSlug) {
  return getLocalizedPath(`/docs/${slug}`, lang);
}

export function getLegacyGettingStartedPath(lang: DocsLocale) {
  return getLocalizedPath("/getting-started", lang);
}

export function getDocsPrevNext(lang: DocsLocale, slug: DocSlug) {
  const pages = getDocsPages(lang);
  const currentIndex = pages.findIndex((page) => page.slug === slug);
  if (currentIndex === -1) {
    return { prev: null, next: null };
  }

  return {
    prev: currentIndex > 0 ? pages[currentIndex - 1] : null,
    next: currentIndex < pages.length - 1 ? pages[currentIndex + 1] : null,
  };
}
