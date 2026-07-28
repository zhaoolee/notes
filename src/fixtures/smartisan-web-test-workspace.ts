import type { NoteDocument, NoteWorkspace } from "../types/app.js";

export const SMARTISAN_WEB_TEST_DATA_ID = "smartisan-web-20";
export const SMARTISAN_WEB_TEST_WORKSPACE_STORAGE_KEY =
  "notes.workspace.smartisan-web-20.v1";

const SMARTISAN_WEB_TEST_NOTES: NoteDocument[] = [
  {
    id: "smartisan-web-01",
    markdown:
      "[“班味儿”就是要绷得住]\n\n自从 AI 大模型变强之后，有些人认为 AI 可以搞定一切(当然可能是想降本增效找个由头),比如销售这件事，竟然也有人认为可以通过 AI 来复刻无数个“销冠”。\n\n虽然我觉得这事儿极度不靠谱，但确实收到过类似的需求，要求用智能体来实现复刻销售冠军。收到这种需求后，我第一个想法就是：上班就是这么回事，你想干下去，就得能“绷得住”。\n\n面对这类让人蛋疼的需求，如果你当场翻白眼，可能就要被开除了。\n\n如果你能绷得住，或者选择戴个墨镜让别人看不见你的眼神，你就能坚持下去，继续领工资。\n\n当然，有天赋也行，比如你眼睛长得特别小，即使眼神飘忽，别人也发现不了，还以为你在认真听。\n\n虽然大家都知道有些东西就是在扯淡，但你还是得陪着演下去。\n\n我记得在前 AI 时代，AI 还没那么强的时候，我就收到过一些奇葩需求。比如：要求用 AI 监听并检测销售人员陪客户喝酒时的细节\n   (a) 酒杯举了多高\n   (b) 酒倒了多少\n   (c) 将这些数据全部量化出来\n\n当时很多开发人员见了这种需求都惊为天人，说干脆搞个机器人去敬酒得了。甚至还有人开玩笑说，机器人做出来之后得找个测试工程师陪它喝，等到测试工程师喝喝倒了就能下班。\n\n我本以为这种离谱的事遇到一次就到头了，没想到最近又收到一个类似的：想复刻销售冠军，实现批量产出，为业务助力。\n\n归根结底，如果你想上班，最重要的就是能绷得住。要么戴墨镜，要么眼睛小，要么能完全控制住面部表情以及眼神——这就是你的道行。",
    createdAt: 1781337480000,
    updatedAt: 1781337480000,
    normalOrder: 0,
    pinnedAt: null,
    folderId: null,
    isStarred: false,
    deletedAt: null,
  },
  {
    id: "smartisan-web-02",
    markdown: "test",
    createdAt: 1778809920000,
    updatedAt: 1778809920000,
    normalOrder: 1,
    pinnedAt: null,
    folderId: null,
    isStarred: false,
    deletedAt: null,
  },
  {
    id: "smartisan-web-03",
    markdown:
      "[**运维神器爱马仕**]\n\n最近公司把openclaw接入了企微，但openclaw无论是本体升级和插件升级都非常不平滑，各种问题，需要手动通过vim去改大量配置文件，反复调试，才能恢复正常。\n今天我尝试了hermes的SSH backend模式，让我彻底脱离了枯燥的运维工作。\n\nAI时代运维的几个痛点：\n\n1. 如果你用openclaw，openclaw升级把自己整挂了，你就重回石器时代。\n2. 你如果想用量大管饱的codex，服务器连不上openai的服务器，搞个科学线路还被内网路由ban\n3. 把权限给的太足，大模型抽风删了重要文件很要命\n4. 对于测试环境，把配置文件放到本地，让AI修改，再放回服务器，来回几轮，浪费大量时间，还不如直接线上测试。\n\n用 Hermes 的 SSH backend，可以让hermes默认登陆远程服务器进行操作，同时通过配置，限制只能读写几个特定的路径，而且修改过程中的大模型使用的是本地的科学网络，完全模拟了运维人员的操作。\n\n经典场景：内网有台机器无法联网，开发者可以直接配置Hermes 的 SSH backend，用强力的gpt5.4改内网服务器特定几个文件配置，改完后，AI直接在内网验证效果。",
    createdAt: 1780474860000,
    updatedAt: 1780474860000,
    normalOrder: 2,
    pinnedAt: null,
    folderId: null,
    isStarred: false,
    deletedAt: null,
  },
  {
    id: "smartisan-web-04",
    markdown:
      "[缓解vibe coding疲劳感的方法]\n\n1. 不要盯着过程看，如果一直盯着vibe coding的过程输出，就相当于做实时review步骤，大脑很容易累；\n2. 让大模型管理tumx并行编程，不要人工管理；\n3. vibe coding的机器最好是云服务器，权限多给一些，也能保证个人电脑数据安全\n4. 善用TG机器人，方便查看每一步的对话记录\n5. 甲骨文的白嫖机型很适合vibe coding，网络稳定，IP干净，还永久免费\n6. hermes升级版本确实比openclaw稳定，不想折腾可以上hermes\n7. 一定要多创建commit，同时配合rsync备份仓库，以防遇到意外n",
    createdAt: 1777213200000,
    updatedAt: 1777213200000,
    normalOrder: 3,
    pinnedAt: null,
    folderId: null,
    isStarred: false,
    deletedAt: null,
  },
  {
    id: "smartisan-web-05",
    markdown:
      "[缓解vibe coding疲劳感的方法]\n\n1. 不要盯着过程看，如果一直盯着vibe coding的过程输出，就相当于做实时review步骤，大脑很容易累；\n2. 让大模型管理tumx并行编程，不要人工管理；\n3. vibe coding的机器最好是轻量云服务器，云服务器权限可以多给一些，保证个人电脑数据安全\n4. 善用TG机器人，方便查看每一步的对话记录\n5. 甲骨文的白嫖机型很适合vibe coding，网络稳定，IP干净，还永久免费\n6. hermes升级版本确实比openclaw稳定，不想折腾可以上hermes\n7. 一定要多创建commit，同时配合rsync备份仓库，以防遇到意外n",
    createdAt: 1777772460000,
    updatedAt: 1777772460000,
    normalOrder: 4,
    pinnedAt: null,
    folderId: null,
    isStarred: false,
    deletedAt: null,
  },
  {
    id: "smartisan-web-06",
    markdown: "永葆青春的秘诀就在于“诚实的生活，缓慢地咀嚼，以及谎报自己的年龄”",
    createdAt: 1776315960000,
    updatedAt: 1776315960000,
    normalOrder: 5,
    pinnedAt: null,
    folderId: null,
    isStarred: false,
    deletedAt: null,
  },
  {
    id: "smartisan-web-07",
    markdown:
      "\n![](https://yun.smartisan.com/apps/note/notesimage/Notes_1775913718000.jpeg)\n\n\n\n[**人活着就是要开心**]\n\n在自己的能力范围内，一点苦都不要吃，一点难听的话都不要听，不喜欢的人就删掉。\n\n人生的首要任务是规避苦痛，而非追求幸福，摒弃所有不必要的愧疚感，让自己的感受舒适，是最高准则。\n\n人不是老了才会死，而是随时都会死，所以在自能力范围内一定要好好爱自己，要把自己的感受放在第一位。\n\n格局要打开，能怪别人的事情，尽量不要怪自己。拒绝精神内耗，有事直接发疯。\n\n他人评价，只不过是他认知的投影，当你的境界远高于对方时，他只能用他有限的尺子丈量你。\n\n快乐是一种感觉，与外物无关，排解情绪，保持快乐，活得久才是硬道理！",
    createdAt: 1775914260000,
    updatedAt: 1775914260000,
    normalOrder: 6,
    pinnedAt: null,
    folderId: null,
    isStarred: false,
    deletedAt: null,
  },
  {
    id: "smartisan-web-08",
    markdown:
      "[**Typeless 是一款宝藏APP**]\n\n今天我下载了 Typeless，刚开始是一个无所谓的态度，认为一个普通的声音识别软件能有多厉害呢？但实际玩了一下，发现它的产品力真的很强\n\n## 对比普通的声音转文字软件，它有三个大的优点：\n1. 它对于低声的识别特别强大，即便在办公室轻声细语地气流声讲话，它也能够识别得非常清晰。\n2. 它的实时翻译功能真的完美符合我的需你，你可以说中文，它会实时帮你转换成英文。\n3. 当你讲一些琐碎的口水话时，如果是使用微信这种传统的语音识别，可能会出现乱糟糟的文字；但对于 Typeless ，它会帮你把重复的内容过滤掉，转化为一份相对正式、适合发出去的文本。\n\n## 我目前想到的应用场景有三个：\n1. 适合 Vibe Coding， 以前你需要打字去告诉 AI 如何实现某个功能，现在只需要张嘴对 AI 说：我需要完成某个功能，完全不需要打字，对于字号、颜色或者整体美术风格的调整是比较费时间的，需要打大量的字去告诉 AI 如何去调整。现在有了 Typeless，我们可以快速、频繁地调整产品的细节\n2. 作为智能录音笔，做简单的谈话纪要。我们在工作中，或者与一些熟悉的人谈话时，可能有些想法会天马行空，而有的想法就非常重要。如果我们用 Typeless 进行简单的录音，就可以把重要的信息快速提取出来。\n3. 大量节省回复邮件、回复工作信息的时间。人的时间是有限的。如果某项付费的产品能够为你节省大量的时间，这款产品的付费价值就很高。\n\n我觉得 Typeless 最大的价值，就是能够为你节省大量的时间。即使你是一个打字极快的高手，我也希望你能尝试一下这种输入的新方式，相信Typeless一定会让你收获惊喜。\n此外，它的移动端体验也很棒，它直接替换了你的键盘，即使在极其封闭的 iOS 系统上，也有很好的体验。",
    createdAt: 1775831340000,
    updatedAt: 1775831340000,
    normalOrder: 7,
    pinnedAt: null,
    folderId: null,
    isStarred: false,
    deletedAt: null,
  },
  {
    id: "smartisan-web-09",
    markdown:
      "设计理念：拆绝app图标系列\n\n\n\n\n\n\n\n\n\n![](https://yun.smartisan.com/apps/note/notesimage/Notes_1774685038000.jpeg)",
    createdAt: 1774756080000,
    updatedAt: 1774756080000,
    normalOrder: 8,
    pinnedAt: null,
    folderId: null,
    isStarred: false,
    deletedAt: null,
  },
  {
    id: "smartisan-web-10",
    markdown:
      "设计理念：拆绝app图标系列\n\n\n\n\n![](https://yun.smartisan.com/apps/note/notesimage/Notes_1775742013003.jpeg)\n\n\n\n\n\n\n\n\n![](https://yun.smartisan.com/apps/note/notesimage/Notes_1775742013000.jpeg)",
    createdAt: 1774685640000,
    updatedAt: 1774685640000,
    normalOrder: 9,
    pinnedAt: null,
    folderId: null,
    isStarred: false,
    deletedAt: null,
  },
  {
    id: "smartisan-web-11",
    markdown:
      "## **0x01**\n学术论文，跑起来像事故现场\n有些人能把数学讲到天花乱坠，但代码一运行，性能就开始给现实磕头。最讽刺的是，AI 编程工具上线以后，反而比某些“高学历自信”更会收敛。\n\n## **0x02**\n> 话题：工具有用，不代表它已经配叫 AGI\n计算器很强，飞机也很强，但没人会因为它们好用就喊“通用智能来了”。工程圈最爱犯的错，就是把“能干活”误认成“会思考”。\n\n## **0x03**\n> 话题：如果隐私因为执法需求就不配存在，那干脆全网退回 HTTP\n“反正总有人能监听，所以别谈隐私”——这逻辑跟“反正会丢东西，所以别装门锁”一个水平。很多政策讨论，本质上不是技术难题，是常识缺席。\n\n## **0x04**\n> 话题：开源世界也逃不过流量逻辑\n大家总以为编程圈该靠质量取胜，结果它和餐厅、音乐、短视频一样，照样先奖励会传播的东西。“爆款代码”很多时候不是最好，只是最像爆款。\n\n## **0x05**\n> 话题：大公司不是不会修 bug，它只是先要求你证明自己配被修\n所谓“高端支持”一直都在，只是门票贵得不写在官网上。你以为自己在提缺陷，平台以为你在排队抽奖。\n\n## **0x06**\n> 话题：工单是否被认真对待，很多时候取决于你名字后面跟着谁\n同样一句“这里有问题”，普通用户叫反馈，财富 100 企业客户叫路线图。企业服务最真实的 UX，不在产品里，在销售名单里。\n\n## **0x07**\n> 话题：模型大小的差距，不是在第一步，而是在第四步露馅\n小模型最擅长的不是犯错，而是先说得像对的。真正的能力差距，往往不是单轮回答，而是多走几步以后，坏决策开始复利。\n\n## **0x08**\n> 话题：量化的意义，不是让小模型更体面，而是让大模型勉强上桌\n很多人纠结“8B 原精度”还是“8B 量化版”，实际上真正的问题通常是：你是想守着小模型的尊严，还是给大模型争取一次上机资格？\n\n## **0x09**\n> 话题：版权诉讼最魔幻的地方，是资产估值只在打官司时突然值钱\n如果一个 IP 报税时只值 1 美元，侵权时却想索赔 10 亿美元，那它不是资产，是量子态情绪。很多商业逻辑，经不起“税务口径和法庭口径统一”这件事。\n\n## **0x0A**\n> 话题：版权案里对“网站/API”等概念边界的讨论\n工程里最危险的，不是复杂，而是有人觉得“不用定义也都懂”。一旦开始追问边界，大家就会发现自己平时其实是靠默契在写规范。",
    createdAt: 1774681260000,
    updatedAt: 1774681260000,
    normalOrder: 10,
    pinnedAt: null,
    folderId: null,
    isStarred: false,
    deletedAt: null,
  },
  {
    id: "smartisan-web-12",
    markdown:
      "## **0x01**\n> 话题：AI bot 上线之后，最先到来的不是用户，是限流\n你以为自己在发产品，Hacker News 以为你在开压测。\n\n## **0x02**\n> 话题：把 GitHub 换掉这件事，嘴上很自由，运维上很坐牢\n很多人想逃离平台，不是因为不独立，而是因为自建一套稳定可用的东西，本身就是第二份工作。\n\n## **0x03**\n> 话题：开源替代品最大的问题，不是理想不够大，是免费不够猛\nGitHub 最残酷的护城河，不是代码托管，而是“巨头补贴下的免费全家桶”。\n\n## **0x04**\n> 话题：有些产品不是功能太少，是把所有功能都塞进同一个地狱 UI\n聊天、文档、任务、看板全都想做，最后用户每切一次上下文，都像在翻一次车。\n\n## **0x05**\n> 话题：AI 参与提交记录这件事，最伤的不是代码质量，是信任折旧\n当 commit log 一眼看上去像 AI 批发市场，用户不会先审代码，用户会先怀疑你敢不敢把这玩意部署到自己的服务器。\n\n## **0x06**\n> 话题：安全事故的底线，不是“绝对安全”，是别把恶意代码直接推给几千人\n工程世界里真正的负责，不是保证永不出事，而是至少别把事故自动化、规模化、流水线化。\n\n## **0x07**\n> 话题：程序员的审美经常输给默认值，不是因为默认值好看，是因为默认值不挨骂\n白、灰、黑永远不会惊艳谁，但能以最大概率让所有评审都懒得开口。\n\n## **0x08**\n> 话题：极客项目最迷人的地方，往往就是“完全没必要，但真他妈酷”\n技术人的浪漫，不是解决问题，而是顺手把 DNS 也拿来跑 DOOM。\n\n## **0x09**\n> 话题：苹果砍掉 Mac Pro，不代表专业需求消失，只代表钱去了 AI 工作站\n过去“专业用户”是剪片和录音棚，现在“专业用户”是想在本地堆模型的人。\n\n## **0x0A**\n> 话题：公开 AI 助手最危险的 bug，不一定是胡说八道，可能是顺手把你开盒了\n当 bot 能访问你的资料时，“它知道很多事”和“别人也能套出来”中间，只差一个爆款链接。",
    createdAt: 1774578840000,
    updatedAt: 1774578840000,
    normalOrder: 11,
    pinnedAt: null,
    folderId: null,
    isStarred: false,
    deletedAt: null,
  },
  {
    id: "smartisan-web-13",
    markdown:
      "## **0x01**\n> 话题：AI 写代码，别把锅只甩给 AI\n你见过 AI 写出烂代码，就觉得它不靠谱；可人写的烂系统害人时，行业照样假装那叫“正常交付”。\n\n## **0x02**\n> 话题：开源产品商业化，最烦的不是收费，是翻脸\n最恶心的不是项目想赚钱，最恶心的是先把“社区”当增长工具，等大家把路踩平了，再把门焊死。\n\n## **0x03**\n> 话题：真实云环境，专治“我这边没问题”\n本地 demo 里改个参数就能发布，不代表生产环境也行。真实世界的部署，失败不是报错，失败是连清理现场都得开项目会。\n\n## **0x04**\n> 话题：公司里的软件工程师，和写代码的人，不一定是同一种生物\n在公司里，“优秀软件工程师”常常只是把活交了；“优秀程序员”才会在意代码到底写得像不像人话。\n\n## **0x05**\n> 话题：AI 辅助 PR 的羞耻感，只是版本号问题\n第一次让 AI 帮你提 PR，你会觉得自己像骗子；等到第一千次，你会发现自己连“辅助”两个字都懒得写了。\n\n## **0x06**\n> 话题：中心化信誉系统的宿命，就是被刷爆\n想做公共知识库，还想给每个人一个统一信誉分？那基本等于邀请水军来做系统测试。\n\n## **0x07**\n> 话题：所谓 AI 基础设施，最后还是两个 LLM 套娃盯梢\n一个 LLM 写代码，另一个 LLM 负责审计、总结、贴标签、记账。人类的核心价值，已经快被压缩成“给 API 充钱”。\n\n## **0x08**\n> 话题：技术圈怀旧的本质，是后来者太让人失望\n每次看到老系统、老界面、老硬件，评论区都会自动汇总成一句话：巅峰已过，后面全是下坡路。",
    createdAt: 1774320000000,
    updatedAt: 1774320000000,
    normalOrder: 12,
    pinnedAt: null,
    folderId: null,
    isStarred: false,
    deletedAt: null,
  },
  {
    id: "smartisan-web-14",
    markdown:
      "[每月花两百刀才真正体验到AI的发展]\n\n前段时间白嫖了ChatGPT 200刀的套餐，上周开始大量使用，今早codex忽然有个弹窗，提醒我可以打开快速模式的codex，上周如果开启的话，可以节省至少1小时52分钟。\n\n于是本着把codex薅秃毛的精神，我打开了快速模式，代码生成速度和自测速度马上就快了不止一倍，往常需要AI写一天的任务，现在一个上午就写完了。\n\n我周围的朋友，经常抱怨GLM4.7不够智能，现在看来就是钱没冲够🐶，200刀每月的订阅真的是又快又好，除了贵没有太多缺点。\n\n下午codex又主动弹窗，告诉我全面放开子智能体模式会更快，当然token燃烧速度两倍起步。\n\n对于人类，唯一不可再生的就是时间，如果通过订阅AI能大量节省时间，那订阅AI还是很值得的。\n\n对于程序员，AI是少有的能帮你节省时间的工具，省出的时间，可以遛遛狗，晒晒太阳，发发呆。",
    createdAt: 1773735480000,
    updatedAt: 1773735480000,
    normalOrder: 13,
    pinnedAt: null,
    folderId: null,
    isStarred: false,
    deletedAt: null,
  },
  {
    id: "smartisan-web-15",
    markdown:
      "## **0x01**\n> 话题：加拿大 C-22 法案要求对加拿大人实施大规模元数据监控\n法案表面上似乎要求搜查令，但新增条款允许法官不向当事人提供搜查令副本，这给侵蚀公民自由留下了很大的漏洞。\n\n\n## **0x02**\n> 话题：Chrome DevTools MCP\n用 Playwright 配合 Claude 记录浏览器交互，并把网站抽象成强类型 API；效率很高，但可能违反服务条款，Google 在智能代理 CLI 工具上明显落后，对重度用户来说，Playwright 加 CLI 往往比 MCP 更实用，DevTools MCP 现在在 v0.20.0 中提供了独立 CLI，这能降低 MCP 的 token 成本。\n\n## **0x03**\n> 话题：49MB 的网页\n有人做过一个站，打开一次页面就能吃掉 750MB，因为所有视频都会预加载，网页开发者的网速就该限制在 128kbit/s。纽约时报之类的网站已经臃肿到不值得看，不如干脆默认关闭 JavaScript，去别处看同样的新闻。\n\n\n## **0x04**\n> 话题：现代新闻业的价值\n现代新闻业的经济模型已经失灵，过度收集用户数据正变成媒体的末路变现手段，臃肿网页不仅加载慢，还会在后台空闲时继续浪费 CPU，并通过追踪器侵犯隐私。\n\n## **0x05**\n> 话题：将 Wayland 合成器与窗口管理器分离  \n这是第一次让 Wayland 看起来真正有希望；把合成器和窗口管理拆开在架构上更合理，不过远程访问体验仍落后于 X11\n\n\n## **0x06**\n> 话题：我用 cc 和 codex 用到现在，写前端感觉都是一坨啊\n你应该先用 codex+figma 或 codex+pencil 出设计稿。设计稿必须有正确的元素嵌套关系，明确空间应该是给 padding 还是 margin ，布局走 flex 还是 whatever 。必要时可以手动微调。最后让 codex 根据设计稿出页面。当需要修改的时候，改设计稿，然后让 codex 根据设计稿改代码。\n\n\n## **0x07**\n> 话题：AI 时代如何学习软件工程\n最好的工程师不是写代码最快的人，而是思考最深入的人。软件工程师和 AI 的关系很像医生和 AI 的关系。即使 AI 诊断很准，最终也还是需要医生拍板。AI 是强大的工具，不是替代品，ChatGPT 的代码往往能跑，但总是比老师的解法更复杂；老师的代码更干净、更好维护。所以如果想真正进步，还是得自己学。\n\n## **0x08**\n> 话题：NVIDIA CEO 黄仁勋对未来的展望\n把它叫“采访”都有点低估它了，这简直是一堂关于深度对话的示范课，当黄仁勋意识到自己面对的问题质量很高时，肢体语言明显都变了。\n\n## **0x09**\n> 话题：科技先驱如何看待 AI 革命？\n他们几乎每一场这种讨论都会提到 AlphaGo，我无法想象自己会真正享受一本由 AI 独自写成、或和 AI 一起写成的小说。\n\n## **0x10**\n> 话题：AI PC 能做什么是普通 PC 做不到的？\n有 AI 处理器并不意味着所有 AI 工作负载都会在本地运行。Win11 的 Copilot 目前仍会把你的输入发到微软服务器处理，等微软把大家都推到 Win11、NPU 也普及以后，BIOS 里会不会有关闭 NPU 的选项？这听起来就是监控噩梦。",
    createdAt: 1773636120000,
    updatedAt: 1773636120000,
    normalOrder: 14,
    pinnedAt: null,
    folderId: null,
    isStarred: false,
    deletedAt: null,
  },
  {
    id: "smartisan-web-16",
    markdown:
      "# 一级标题 Heading 1\n\n这是一段普通正文，用来测试**粗体**、*斜体*、***粗斜体***、~~删除线~~、`行内代码`、以及一个自动链接 <https://example.com>。\n\n## 二级标题 Heading 2\n\n这是另一段正文，其中包含一个[行内链接](https://example.com) 和一个脚注标记[^1]。  \n这一行末尾有两个空格来测试换行。  \n这是换行后的内容。\n\n### 三级标题 Heading 3\n\n> 这是一级引用。\n>\n> > 这是二级引用。\n> >\n> > 包含 **粗体** 和 `code`。\n>\n> 引用结束。\n\n---\n\n## 列表测试\n\n### 无序列表\n\n- 第一项\n- 第二项\n  - 二级子项 A\n  - 二级子项 B\n    - 三级子项 B-1\n- 第三项\n\n### 有序列表\n\n1. 第一项\n2. 第二项\n   1. 子项 2.1\n   2. 子项 2.2\n3. 第三项\n\n### 任务列表\n\n- [x] 已完成任务\n- [ ] 未完成任务\n- [ ] 另一个待办项\n\n---\n\n## 代码测试\n\n### 行内代码\n\n请执行 `npm install` 然后运行 `npm run dev`。\n\n### 代码块：JavaScript\n\n```javascript\nfunction greet(name) {\n  console.log(`Hello, ${name}!`);\n}\n\ngreet(\"Markdown\");\n```\n\n### 代码块：Python\n\n```python\ndef fib(n: int) -> list[int]:\n    a, b = 0, 1\n    result = []\n    while a < n:\n        result.append(a)\n        a, b = b, a + b\n    return result\n\nprint(fib(50))\n```\n\n### 代码块：JSON\n\n```json\n{\n  \"name\": \"markdown-test\",\n  \"version\": \"1.0.0\",\n  \"features\": [\"headings\", \"lists\", \"code\", \"tables\"]\n}\n```\n\n---\n\n## 表格测试\n\n| 名称 | 类型 | 状态 | 备注 |\n|------|------|------|------|\n| 标题 | block | ✅ | 支持多级 |\n| 列表 | block | ✅ | 支持嵌套 |\n| 代码 | block | ✅ | 支持高亮 |\n| 表格 | block | ✅ | 对齐可能不同 |\n\n### 对齐测试\n\n| 左对齐 | 居中对齐 | 右对齐 |\n|:------|:--------:|------:|\n| left  | center   | right |\n| aaa   |   bbb    |   ccc |\n\n---\n\n## 图片测试\n\n![示例图片](https://via.placeholder.com/300x100.png?text=Markdown+Image)\n\n---\n\n## 分隔与数学符号测试\n\n上面有一条分割线，下面测试一些特殊字符：\n\n- HTML 实体：&copy; &lt;div&gt; &amp; &nbsp;\n- 数学/符号：± × ÷ ≠ ≤ ≥ → ← ↑ ↓\n- Emoji：😀 🚀 ✅ 🔥\n\n---\n\n## 混合排版测试\n\n1. 列表里放引用：\n   > 这里是列表中的引用文本。\n\n2. 列表里放代码：\n\n   ```bash\n   git status\n   git add .\n   git commit -m \"test markdown\"\n   ```\n\n3. 列表里放表格：\n\n   | Key | Value |\n   |-----|-------|\n   | A   | 123   |\n   | B   | 456   |\n\n---\n\n## HTML 兼容测试\n\n<b>这是 HTML 粗体</b><br>\n<i>这是 HTML 斜体</i><br>\n<kbd>Ctrl</kbd> + <kbd>C</kbd>\n\n---\n\n## 脚注测试\n\n这里有一个脚注引用[^longnote]。\n\n[^1]: 这是一个简单脚注。  \n[^longnote]: 这是一个较长的脚注内容，用来测试脚注区域的渲染效果。\n\n---\n\n## 最后一段\n\n> **Markdown 渲染测试完成。**  \n> 你可以重点观察：标题大小、段落间距、列表缩进、代码高亮、表格边框、引用样式、图片显示、脚注位置，以及 HTML 是否被正确处理。",
    createdAt: 1773546900000,
    updatedAt: 1773546900000,
    normalOrder: 15,
    pinnedAt: null,
    folderId: null,
    isStarred: false,
    deletedAt: null,
  },
  {
    id: "smartisan-web-17",
    markdown:
      "## **0x01**\n> 话题：到 2027 年，美国新车将被强制配备联邦监控技术\n如果我在加州乡下家里喝了酒，深夜突然遇到山火需要逃命，我的车还会允许我开走吗？如果这辆车是政府免费送的，我也许会考虑接受这些条件；否则完全没兴趣。\n\n\n## **0x02**\n> 话题：Han，一门用 Rust 编写的韩语编程语言\n编程语言关键字本来就只有很少一撮词汇，真正困难的是阅读高级英文文档，而不是理解像 `int` 这样的词。很多人都是先学编程、后学英语，而关键字和 API 从来不是主要障碍。代码在大脑里本来就和自然语言不是同一个处理区。\n\n\n## **0x03**\n> 话题：Ageless Linux：一个拒绝年龄验证的抗议型 Linux 项目\n年龄验证争论几乎同时在美国、英国和欧盟等地出现，而且用的是相似的逻辑谬误。孩子在网上做什么，其实早就可以通过家长管理和家长控制软件来解决，如果你过去 15 年一直在看政治趋势，这一点并不奇怪。很多国家几乎同时在做同样的事，看起来像是被协调推动的。就像建筑风格在互联网时代逐渐全球同质化一样，政治与观念也可能正在变成同一种单一文化。\n\n\n## **0x04**\n> 话题：ToxFREE 项目检测的所有耳机中都发现了有害物质 \n这么看，木头和皮革也许才一直是更靠谱的材料？我们真的发明出过“对激素友好”的塑料吗？如果热和汗会加速耳机中的化学物质迁移到皮肤，那跑鞋呢？鞋里往往还有更多胶水和化学材料。\n\n## **0x05**\n> 话题：空客正在准备两款无人作战飞机  \n如果项目成功，就等于证明空客能把自己的软件体系叠加到第三方平台上并顺利运转。这个方向整体合理，但架构问题很多：无人机编队会不会更容易被雷达发现？号称“可消耗”的无人机，成本真的低到可以放心损失吗？\n\n\n## **0x06**\n> 话题：在 Raspberry Pi 5 上运行Linux Fedora 44 \n玩硬件的第一条规则就是先把散热支持搞定。树莓派的软件支持，只有当你完全留在基金会自己的生态里时才算顺滑。\n\n\n## **0x07**\n> 话题：做了一款小程序：剪了么，一键记录剪发时间、周期性提醒该剪发了\n这就是所谓的人人都是产品经理，单纯的好奇，老哥每天起床不洗漱，照镜子吗？伸手摸摸头就能做到的事情。\n\n## **0x08**\n> 话题：AI 会这样毁灭人类吗？\n人们把思考交给机器，本想换来自由，结果却让掌握机器的另一群人更容易奴役他们。\n\n## **0x09**\n> 话题：哈佛 CS50：Python 人工智能完整大学课程\n如果你什么时候觉得自己没用，就想想居然还有人给这门顶级免费课程点了踩。\n\n## **0x10**\n> 话题：如何在课堂中使用人工智能？\n如果学生必须戴这个，那老师也该戴，这样我们也能看看老师到底有多专注于教育。孩子就是孩子，让他们去玩，而不是像监控机器一样监控他们。如果连打哈欠和看手机都要被监控，那学生在学校里基本连犯困和无聊的权利都没有了。",
    createdAt: 1773542760000,
    updatedAt: 1773542760000,
    normalOrder: 16,
    pinnedAt: null,
    folderId: null,
    isStarred: false,
    deletedAt: null,
  },
  {
    id: "smartisan-web-18",
    markdown:
      "## **0x01**\n如果游戏开箱要被监管，那为什么像宝可梦卡包这样的现实版“开箱”不一起管？如果大家都承认开箱是赌博，那 16 岁就允许，逻辑上还是不太一致。\n> 话题：欧洲将含开箱机制的游戏标为至少 16 岁\n\n## **0x02**\n现在更换一台台式机已经变成一件很贵、很焦虑的事，因为配件价格涨了太多。讽刺的是，美国才刚在 2024 年把战略氦储备处理掉。\n> 话题：卡塔尔氦气停供冲击芯片供应链\n\n## **0x03**\nClaude Code 现在看起来把普通 Opus 和 1M Opus 合并了，最大的变化是 100 万上下文现在按标准价格计费，而且图片 / PDF 上限也更高了。\n> 话题：Opus / Sonnet 100 万上下文正式开放\n\n## **0x04**\n小型本地模型很适合嵌入式任务，但对大多数人来说，写代码还是直接用成熟的云端工具更划算。\n> 话题：我能在本地运行 AI 吗？\n\n## **0x05**\n这个应用让 YouTube 变得更“有边界感”，没有原生推荐流那么让人疲惫，体验反而更舒服。\n> 话题：像看有线电视一样看 YouTube https://channelsurfer.tv/\n\n## **0x06**\n更可怕的不只是密钥泄露，而是 Algolia 似乎没有回应，而且文档本身就在引导用户使用危险默认值。\n> 话题：39 个 Algolia 管理员密钥暴露\n\n## **0x07**\nHammerspoon 是一个 macOS 自动化工具，本质上是“用代码控制 Mac”，维护者表示，未来的 v2 版本可能会从 Lua 转向 JavaScript。\n> 话题：任何可以用 JavaScript 来写的应用，最终都将用 JavaScript 来写\n\n## **0x08**\n公司给我发工资，我拿工资买 token，太离谱了。\n> 话题：教育优惠 > 破解 > 拼车 > 自用付费 > 公事付费",
    createdAt: 1773465900000,
    updatedAt: 1773465900000,
    normalOrder: 17,
    pinnedAt: null,
    folderId: null,
    isStarred: false,
    deletedAt: null,
  },
  {
    id: "smartisan-web-19",
    markdown:
      "## **0x01**\n时间是唯一不可再生的资源。AI 大模型是目前我所知的最便宜的赚取额外时间的方式。\n> 话题：订阅AI的价值\n\n## **0x02**\n「批准」应该存在于控制层，而不是自然语言里。如果 UI 问「是/否」，「否」应该被强制执行为阻止写入操作的状态转换，而不是作为更多文本传回模型让模型解释。\n> 话题：AI 问\"要实现吗？\"，作者说\"No\"，AI 还是继续实现了...\n\n## **0x03**\n认为“愿意看起来很蠢”在私下或熟人场景更容易，真正难的是在公开环境里承受社交代价。\n> 话题：愿意看起来很蠢\n\n## **0x04**\n通过 `printf '\\e]8;;http://evil.com\\e\\\\https://good.com\\e]8;;\\e\\\\\\n'` 可以在终端创建链接，看起来是`https://good.com` ，实际跳转到`http://evil.com`。\n> 话题：终端实现诈骗超链接技术讨论\n\n## **0x05**\nNeo 看起来是挺不错的，但我实在看不出它比 “一台不错的低端电脑” 有更大意义。相比 Chromebook 和廉价 PC 早已有的东西，只能算是增量改进。就我个人而言，我觉得 Steam Deck 更有机会把一台通用计算设备“偷渡”进那些原本并不打算买这种东西的家庭里。\n> 话题：买Mac Neo不如买Steam Deck\n\n## **0x06**\n大多数人觉得是 Netflix 杀死了 Blockbuster，但严格来说并不准确。真正把 Blockbuster，乃至整个录像租赁模式送进坟墓的，是 Netflix 和 Redbox 的组合。通常要彻底替代一个旧范式，不是靠一件事，而是至少两件事共同补齐它的全部功能。\n> 话题：技术变革\n\n## **0x07**\n想吃某些东西的并不是“你”，而是你肠道里的微生物群。那里有一些微生物专门吃某些东西，比如糖。你不给它们糖，它们就会向你的大脑发信号，说“喂，再来点糖”。这就是为什么如果你开始无糖饮食，也就是不再吃糖果和甜食，那种渴望最终会消失。那些一直大喊“更多糖”的微生物，要么死掉，要么进入休眠状态。\n> 话题：无糖饮食对人的影响\n\n## **0x08**\n有 80% 的时候，我只是问 Claude Code 一个问题，它却会擅自假设我是因为不同意它之前说的话才来问，然后基于这个假设采取行动。我现在都被迫在后面附加类似“这只是一个问题。不要改代码。不要跑命令”这种话。太离谱了。\n> 话题：TMD别改我代码",
    createdAt: 1773385800000,
    updatedAt: 1773385800000,
    normalOrder: 18,
    pinnedAt: null,
    folderId: null,
    isStarred: false,
    deletedAt: null,
  },
  {
    id: "smartisan-web-20",
    markdown:
      "## **0x01**\n最近关于OpenClaw的讨论很多，我的理发师都知道OpenClaw了，还订了Mac mini\n> 话题：OpenClaw很火\n\n## **0x02**\n如果Moltbook能像Instagram一样大，我就去山里养山羊\n> 话题：Meta收购Moltbook（AI社交网络）\n\n## **0x03**\n\"我 15 年前用 PHP 写的东西，比现在 AI 用 TypeScript 做的还好\"，评论区 PHP 大战 TS\n> 话题：PHP大翻身\n\n## **0x04**\n\"不玩零和游戏\"听起来很酷，但房租还是零和游戏啊！\n> 话题：为他人创造价值，别担心回报\n\n## **0x05**\nMoltbook是AI机器人假装人类，Facebook是人类假装AI？等等……\n> 话题：Moltbook智能体社区\n\n## **0x06**\n如果一个人觉得他说的东西不值得花时间写出来，这对我来说就是一个信号：他说的可能也不值得我花时间读。\n> 话题：HN禁止AI生成评论\n\n## **0x07**\n麦肯锡想用咨询的方法做软件。这行不通。你不能做一个东西 6 个月然后就不管了。软件是会腐烂的。他们在 2024 年裁掉了很多很优秀的软件工程师，这反映了他们如何看待软件开发。\n> 话题：AI Agent 两小时黑进麦肯锡\n\n## **0x08**\n我来这里就是想看聪明人的真实想法，而不是我自己问 LLM 也能得到的东西。LLM 只是个自动补全引擎，它没有好奇心，请用你的人类声音表达你的好奇心。\n> 话题：AI生成评论的问题",
    createdAt: 1773278460000,
    updatedAt: 1773278460000,
    normalOrder: 19,
    pinnedAt: null,
    folderId: null,
    isStarred: false,
    deletedAt: null,
  },
];

export function createSmartisanWebTestWorkspace(): NoteWorkspace {
  return {
    activeNoteId: SMARTISAN_WEB_TEST_NOTES[0].id,
    folders: [],
    notes: SMARTISAN_WEB_TEST_NOTES.map((note) => ({ ...note })),
    version: 1,
  };
}
