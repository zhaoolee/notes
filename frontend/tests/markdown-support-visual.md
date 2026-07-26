# H1 一级标题：Markdown 兼容性矩阵

导语段落：用于检查中文、English、数字 123、标点「」以及 Emoji 😀🚀 是否能共同显示。

## 01 行内文本

普通文本、**粗体 Bold**、*斜体 Italic*、***粗斜体 Bold Italic***、~~删除线~~、`inline code`。

[命名链接](https://example.com) 与自动链接 <https://example.org>。

转义字符：\*不是斜体\*、\# 不是标题、反斜杠 \\。

## 02 标题层级

### H3 三级标题

#### H4 四级标题

##### H5 五级标题

###### H6 六级标题

标题后的普通正文，用来观察层级、字号、行高和间距。

## 03 段落与换行

第一段第一行。
同一段中的软换行，预期浏览器合并为一个空格。

这一行末尾有两个空格。  
这一行应当硬换行显示。

上方和下方均保留了 Markdown 空行。

## 04 引用与分隔线

> 一级引用：工匠精神不是口号。
>
> > 二级引用：嵌套内容包含 **粗体** 与 `code`。
>
> 回到一级引用。

---

分隔线下方正文。

## 05 列表

- 无序项目 A
- 无序项目 B
  - 二级项目 B.1
    - 三级项目 B.1.1
- 无序项目 C

1. 有序项目一
2. 有序项目二
   1. 二级编号 2.1
   2. 二级编号 2.2
3. 有序项目三

- [x] 已完成任务
- [ ] 未完成任务

## 06 代码

行内命令：`npm run dev`。

```javascript
function greet(name) {
  return `Hello, ${name}!`;
}

console.log(greet("Markdown"));
```

```text
纯文本代码块
保留    连续空格
<tag> 不应被当作 HTML
```

## 07 表格

| 左对齐 | 居中对齐 | 右对齐 |
|:-------|:--------:|-------:|
| Alpha | Center | 100 |
| 中文内容 | 居中 | 200 |
| **粗体** | `code` | 300 |

## 08 图片

![本地测试图片](/example-assets/dog.jpeg)

图片后正文，用来检查图片加载、宽度约束和上下间距。

## 09 特殊字符

HTML 实体：&copy; &lt;div&gt; &amp; &nbsp;

数学与方向符号：± × ÷ ≠ ≤ ≥ → ← ↑ ↓

Emoji：😀 🚀 ✅ 🔥 🎉

## 10 原始 HTML

下面三行用于判断是否支持原始 HTML：

<mark>HTML mark 标签</mark>
<kbd>Ctrl</kbd> + <kbd>C</kbd>
<span style="color:red">红色 HTML 文本</span>

## 11 脚注

这里有一个脚注引用[^note]。

[^note]: 这是脚注内容，包含 **粗体**。

## 12 综合嵌套

1. 列表中的引用：

   > 引用内容与 **粗体**。

2. 列表中的代码：

   ```bash
   npm test
   npm run build
   ```

3. 列表中的表格：

   | Key | Value |
   |-----|-------|
   | A | 123 |
   | B | 456 |

测试结束标记：`MARKDOWN_VISUAL_TEST_END`
