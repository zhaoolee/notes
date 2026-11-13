/**
 * 静态网站主题文件。
 *
 * 由服务端在生成 Hugo 站点时写入磁盘，再由 Hugo Extended 0.162.1 构建。
 * 主题只有一个稳定标识 smartisan-blog；文件表的键均为 Hugo 项目内的相对路径，
 * 所有站内链接都通过 relURL、RelPermalink 或模板注入生成，因此同一份主题
 * 既可用于根路径（basePath=/），也可用于 /nested/blog/ 这类子路径。
 *
 * 约定：
 * - 未填写站点域名时 baseURL 是 basePath（例如 / 或 /blog/），站内链接全部使用
 *   RelPermalink / relURL，不引入任何虚假域名；此时不输出 canonical，也不生成
 *   RSS 与 sitemap，首页只输出 HTML 与 JSON。
 * - 填写域名时首页输出 HTML、RSS、JSON，生成 canonical、RSS 与 sitemap。
 * - 搜索索引始终使用 RelPermalink，浏览器按当前站点地址解析，不绑定具体域名。
 * - 搜索页内容来自 content/search/_index.md 或 content/search/index.md，
 *   由 layouts/_default/search.html 或 layouts/search/* 渲染，使用本地 JSON 索引，
 *   不依赖任何在线索引服务或额外的 npm 搜索依赖。
 * - 背景和 logo 由调用方放在 static/assets/bg.jpg 和 static/logo.png；正文只使用
 *   系统字体栈，不打包字体文件；CSS 位于 css/，故使用 ../assets/ 相对地址。
 * - 分类菜单由 hugo.json 的 menu.main 提供，不在这里硬编码任何分类。
 * - 图片 render hook 只输出页面资源或经过协议白名单校验的地址，不引入 safeHTML。
 */

const SITE_THEME_ID = "smartisan-blog";

const SITE_THEME_FILES: Record<string, Record<string, string>> = {
  [SITE_THEME_ID]: {
    "layouts/_default/baseof.html": `<!doctype html>
<html lang="{{ site.Language.Locale | default "zh-CN" }}">
  <head>
    {{- $description := site.Params.description | default "" -}}
    {{- with .Description }}{{ $description = . }}{{ else }}{{ if not .IsHome }}{{ with .Summary }}{{ $description = . | plainify | htmlUnescape | chomp }}{{ end }}{{ end }}{{ end }}
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="{{ $description | plainify | htmlUnescape | replaceRE "[[:space:]]+" " " | strings.TrimSpace | truncate 160 }}">
    {{- if or (eq .Section "search") (eq .Layout "search") (eq .Type "search") }}
    <meta name="robots" content="noindex">
    {{- end }}
    <title>{{ if .IsHome }}{{ site.Title }}{{ else }}{{ .Title }} - {{ site.Title }}{{ end }}</title>
    {{- if site.Params.notesHasDomain }}
    <link rel="canonical" href="{{ .Permalink }}">
    {{- end }}
    {{- $icon := "logo.png" | relURL -}}
    {{- with site.Params.favicon }}{{ $icon = . }}{{ if not (strings.HasPrefix $icon "http") }}{{ $icon = strings.TrimPrefix "/" $icon | relURL }}{{ end }}{{ end }}
    <link rel="icon" href="{{ $icon }}">
    {{- if site.Params.notesHasDomain }}{{ with .OutputFormats.Get "rss" }}
    <link rel="alternate" type="application/rss+xml" href="{{ .RelPermalink }}" title="{{ site.Title }}">
    {{- end }}{{- end }}
    {{- block "head" . }}{{ end }}
    {{- with resources.Get "css/site.css" }}
      {{- with . | minify | fingerprint "sha256" }}
    <link rel="stylesheet" href="{{ .RelPermalink }}" integrity="{{ .Data.Integrity }}" crossorigin="anonymous">
      {{- end }}
    {{- end }}
    {{- with resources.Get "js/sidebar.js" }}
      {{- with . | minify | fingerprint "sha256" }}
    <script defer src="{{ .RelPermalink }}" integrity="{{ .Data.Integrity }}" crossorigin="anonymous"></script>
      {{- end }}
    {{- end }}
  </head>
  <body>
    <input class="site-nav-toggle" id="site-nav-toggle" type="checkbox" aria-label="展开导航">
    <label class="site-nav-button" for="site-nav-toggle" aria-hidden="true">
      <span></span>
      <span></span>
      <span></span>
    </label>
    <div class="site-shell">
      {{ partial "sidebar.html" . }}
      <main class="site-main">
        {{ block "main" . }}{{ end }}
      </main>
    </div>
  </body>
</html>
`,
    "layouts/_default/list.html": `{{ define "main" }}
  <section class="reader-sheet">
    <span class="reader-sheet-corner reader-sheet-corner-top-left" aria-hidden="true"></span>
    <span class="reader-sheet-corner reader-sheet-corner-top-right" aria-hidden="true"></span>
    <span class="reader-sheet-corner reader-sheet-corner-bottom-left" aria-hidden="true"></span>
    <span class="reader-sheet-corner reader-sheet-corner-bottom-right" aria-hidden="true"></span>
    <header class="article-header">
      <h1>{{ .Title }}</h1>
    </header>
    {{ with .Content }}
      <div class="article-content">{{ . }}</div>
    {{ end }}
    {{ $pages := where .RegularPages.ByDate.Reverse "Section" "ne" "search" }}
    {{ if $pages }}
      <ol class="post-list">
        {{ range $pages }}
          <li>
            <a href="{{ .RelPermalink }}">{{ .Title }}</a>
            {{ if not .Date.IsZero }}<time datetime="{{ .Date.Format "2006-01-02" }}">{{ .Date.Format "2006-01-02" }}</time>{{ end }}
          </li>
        {{ end }}
      </ol>
    {{ end }}
  </section>
{{ end }}
`,
    "layouts/_default/single.html": `{{ define "main" }}
  {{ $hasToc := gt (len (findRE "<li>" .TableOfContents)) 0 }}
  <div class="article-page has-toc">
    <aside class="article-toc" aria-label="文章目录">
      <div class="article-toc-title">目录</div>
      <nav class="article-toc-root" aria-label="文章标题">
        <ul>
          <li><a href="#article-top">{{ .Title }}</a></li>
        </ul>
      </nav>
      {{ if $hasToc }}
        {{ .TableOfContents }}
      {{ end }}
    </aside>
    <article class="reader-sheet" id="article-top">
    <span class="reader-sheet-corner reader-sheet-corner-top-left" aria-hidden="true"></span>
    <span class="reader-sheet-corner reader-sheet-corner-top-right" aria-hidden="true"></span>
    <span class="reader-sheet-corner reader-sheet-corner-bottom-left" aria-hidden="true"></span>
    <span class="reader-sheet-corner reader-sheet-corner-bottom-right" aria-hidden="true"></span>
      <header class="article-header">
        <h1>{{ .Title }}</h1>
        <div class="article-meta">
          {{ if not .Date.IsZero }}<time datetime="{{ .Date.Format "2006-01-02" }}">{{ .Date.Format "2006-01-02" }}</time>{{ end }}
          {{ with .Params.categories }}<span class="article-categories">{{ delimit . " / " }}</span>{{ end }}
        </div>
      </header>
      <div class="article-content">
        {{ .Content }}
      </div>
    </article>
  </div>
{{ end }}
`,
    "layouts/_default/search.html": `{{ define "main" }}
{{ partial "search-page.html" . }}
{{ end }}
`,
    "layouts/robots.txt": `User-agent: *
Allow: /
{{- if site.Params.notesHasDomain }}
Sitemap: {{ "sitemap.xml" | absURL }}
{{- end }}
`,
    "layouts/_default/_markup/render-image.html": `{{- $destination := .Destination -}}
{{- $parsed := urls.Parse $destination -}}
{{- $scheme := lower $parsed.Scheme -}}
{{- $allowed := or (eq $scheme "") (eq $scheme "http") (eq $scheme "https") (and (eq $scheme "data") (strings.HasPrefix (lower $destination) "data:image/")) -}}
{{- $resource := "" -}}
{{- $fallback := $destination -}}
{{- if and (eq $scheme "") (strings.HasPrefix $destination "/") (not (strings.HasPrefix $destination "//")) -}}
  {{- $fallback = strings.TrimPrefix "/" $destination | relURL -}}
{{- end -}}
{{- if and $allowed (eq $scheme "") -}}
  {{- $path := strings.TrimPrefix "./" $parsed.Path -}}
  {{- $resource = .PageInner.Resources.GetMatch $path -}}
{{- end -}}
{{- if and $resource (eq $resource.MediaType.MainType "image") -}}
  <img src="{{ $resource.RelPermalink }}" width="{{ $resource.Width }}" height="{{ $resource.Height }}" alt="{{ .PlainText }}" loading="lazy" decoding="async"{{ with .Title }} title="{{ . }}"{{ end }}>
{{- else if $allowed -}}
  <img src="{{ $fallback | safeURL }}" alt="{{ .PlainText }}" loading="lazy" decoding="async"{{ with .Title }} title="{{ . }}"{{ end }}>
{{- else -}}
  <span class="image-unavailable">{{ .PlainText }}</span>
{{- end -}}
`,
    "layouts/_default/_markup/render-link.html": `{{- $destination := .Destination -}}
{{- $parsed := urls.Parse $destination -}}
{{- if and (eq (lower $parsed.Scheme) "") (strings.HasPrefix $destination "/") (not (strings.HasPrefix $destination "//")) -}}
  {{- $destination = strings.TrimPrefix "/" $destination | relURL -}}
{{- end -}}
<a href="{{ $destination }}"{{ with .Title }} title="{{ . }}"{{ end }}>{{ .Text }}</a>
`,
    "layouts/partials/sidebar.html": `<aside class="sidebar" aria-label="站点导航">
  <div class="sidebar-head">
    <a class="site-brand" href="{{ site.Home.RelPermalink }}" aria-label="{{ site.Title }}">
      <img src="{{ "logo.png" | relURL }}" alt="" width="40" height="40">
      <span>{{ site.Title }}</span>
    </a>
    <form class="sidebar-search-form" action="{{ "search/" | relURL }}" method="get" role="search">
      <label class="sidebar-search-field">
        <span class="sidebar-search-icon" aria-hidden="true"></span>
        <input type="search" name="q" placeholder="快速搜索关键字" aria-label="搜索站内内容">
      </label>
    </form>
    <div class="sidebar-mode-toggle" role="tablist" aria-label="导航模式">
      <button class="sidebar-mode-button" type="button" data-sidebar-mode-button="latest" aria-selected="true">最新</button>
      <button class="sidebar-mode-button" type="button" data-sidebar-mode-button="sections" aria-selected="false">专题</button>
    </div>
  </div>
  <nav class="sidebar-nav sidebar-nav-latest" data-sidebar-panel="latest" aria-label="最新文章">
    <ul>
      {{ $latest := slice }}
      {{ range site.RegularPages }}
        {{ if and (ne .Section "search") (ne .Layout "search") (ne .Type "search") (ne .Params.searchExclude true) }}
          {{ $latest = $latest | append . }}
        {{ end }}
      {{ end }}
      {{ range $latest.ByDate.Reverse }}
        {{ $sectionTitle := .Section }}
        {{ with .Section }}{{ with site.GetPage . }}{{ $sectionTitle = .Title }}{{ end }}{{ end }}
        <li>
          <a href="{{ .RelPermalink }}" class="{{ if eq $.RelPermalink .RelPermalink }}active{{ end }}">
            <span class="sidebar-post-meta">{{ if not .Date.IsZero }}{{ .Date.Format "2006-01-02" }} · {{ end }}{{ $sectionTitle }}</span>
            <span class="sidebar-post-title">{{ .Title }}</span>
          </a>
        </li>
      {{ end }}
    </ul>
  </nav>
  <nav class="sidebar-nav sidebar-nav-sections" data-sidebar-panel="sections" aria-label="专题目录" hidden>
    <ul>
      {{ range site.Menus.main }}
        {{ $entry := . }}
        {{ $entryPage := .Page }}
        {{ if and (not $entryPage) .PageRef }}{{ $entryPage = site.GetPage .PageRef }}{{ end }}
        {{ $entryURL := .URL }}
        {{ if and (not $entryPage) (not (strings.HasPrefix $entryURL "http")) }}
          {{ $lookup := strings.TrimPrefix site.Home.RelPermalink $entryURL }}
          {{ $lookup = strings.TrimSuffix "/" (strings.TrimPrefix "/" $lookup) }}
          {{ if $lookup }}{{ with site.GetPage $lookup }}{{ $entryPage = . }}{{ end }}{{ end }}
        {{ end }}
        {{ with $entryPage }}{{ $entryURL = .RelPermalink }}{{ else }}{{ if not (strings.HasPrefix $entryURL "http") }}{{ if not (strings.HasPrefix $entryURL site.Home.RelPermalink) }}{{ $entryURL = strings.TrimPrefix "/" $entryURL | relURL }}{{ end }}{{ end }}{{ end }}
        <li>
          <a href="{{ $entryURL }}" class="{{ if or ($.IsMenuCurrent "main" $entry) (and $entryPage (eq $.RelPermalink $entryPage.RelPermalink)) }}active{{ end }}">{{ .Name }}</a>
          {{ with $entryPage }}
            {{ $children := .RegularPages.ByDate.Reverse }}
            {{ if $children }}
              <ul>
                {{ range $children }}
                  <li><a href="{{ .RelPermalink }}" class="{{ if eq $.RelPermalink .RelPermalink }}active{{ end }}">{{ .Title }}</a></li>
                {{ end }}
              </ul>
            {{ end }}
          {{ end }}
        </li>
      {{ end }}
    </ul>
  </nav>
</aside>
`,
    "layouts/partials/search-page.html": `  <section class="reader-sheet search-sheet">
    <span class="reader-sheet-corner reader-sheet-corner-top-left" aria-hidden="true"></span>
    <span class="reader-sheet-corner reader-sheet-corner-top-right" aria-hidden="true"></span>
    <span class="reader-sheet-corner reader-sheet-corner-bottom-left" aria-hidden="true"></span>
    <span class="reader-sheet-corner reader-sheet-corner-bottom-right" aria-hidden="true"></span>
    <header class="article-header">
      <h1>{{ .Title }}</h1>
    </header>
    <div class="article-content search-page">
      {{ .Content }}
      <form class="search-page-form" action="{{ "search/" | relURL }}" method="get" role="search">
        <label class="search-page-field">
          <span class="search-page-icon" aria-hidden="true"></span>
          <input type="search" id="search-page-input" name="q" placeholder="搜索文章标题或正文" aria-label="搜索文章标题或正文" autocomplete="off">
        </label>
      </form>
      <p class="search-status" id="search-status" role="status" aria-live="polite"></p>
      <ol class="search-results" id="search-results"></ol>
      <noscript>
        <p>搜索功能需要启用 JavaScript。</p>
      </noscript>
    </div>
  </section>
  {{ $searchIndex := "index.json" | relURL }}
  {{ with site.Home.OutputFormats.Get "json" }}{{ $searchIndex = .RelPermalink }}{{ end }}
  <script src="{{ "js/search.js" | relURL }}" data-search-index="{{ $searchIndex }}" defer></script>
`,
    "layouts/index.html": `{{ define "main" }}
  <section class="reader-sheet">
    <span class="reader-sheet-corner reader-sheet-corner-top-left" aria-hidden="true"></span>
    <span class="reader-sheet-corner reader-sheet-corner-top-right" aria-hidden="true"></span>
    <span class="reader-sheet-corner reader-sheet-corner-bottom-left" aria-hidden="true"></span>
    <span class="reader-sheet-corner reader-sheet-corner-bottom-right" aria-hidden="true"></span>
    <header class="article-header">
      <h1>{{ site.Title }}</h1>
      {{ with site.Params.description }}<p class="home-description">{{ . }}</p>{{ end }}
    </header>
    {{ with .Content }}
      <div class="article-content">{{ . }}</div>
    {{ end }}
    {{ $pages := slice }}
    {{ range site.RegularPages }}
      {{ if and (ne .Section "search") (ne .Layout "search") (ne .Type "search") (ne .Params.searchExclude true) }}
        {{ $pages = $pages | append . }}
      {{ end }}
    {{ end }}
    {{ if $pages }}
      <h2 class="home-list-title">最新文章</h2>
      <ol class="post-list home-post-list">
        {{ range $pages.ByDate.Reverse }}
          <li>
            <a href="{{ .RelPermalink }}">{{ .Title }}</a>
            {{ if not .Date.IsZero }}<time datetime="{{ .Date.Format "2006-01-02" }}">{{ .Date.Format "2006-01-02" }}</time>{{ end }}
          </li>
        {{ end }}
      </ol>
    {{ end }}
  </section>
{{ end }}
`,
    "layouts/index.json": `{{- $pages := slice -}}
{{- range site.RegularPages -}}
  {{- if and (ne .Section "search") (ne .Layout "search") (ne .Type "search") (ne .Params.searchExclude true) -}}
    {{- $text := .Plain | replaceRE "[[:space:]]+" " " | strings.TrimSpace -}}
    {{- $pages = $pages | append (dict "title" .Title "permalink" .RelPermalink "text" $text) -}}
  {{- end -}}
{{- end -}}
{{- dict "title" site.Title "pages" $pages | jsonify -}}
`,
    "layouts/search/list.html": `{{ define "main" }}
{{ partial "search-page.html" . }}
{{ end }}
`,
    "layouts/search/single.html": `{{ define "main" }}
{{ partial "search-page.html" . }}
{{ end }}
`,
    "assets/css/site.css": `:root {
  --bg: #ede1ce;
  --paper: #fefcf6;
  --frame: rgba(237, 233, 225, 0.92);
  --ink: #3f2f22;
  --muted: #8d7761;
  --accent: #8f5c2c;
  --accent-strong: #6f4219;
  --sidebar: rgb(251, 247, 237);
  --sidebar-line: rgb(228, 218, 209);
  --sidebar-ink: #5b4638;
  --sidebar-muted: #8a6847;
  --sheet-shadow: 0 24px 42px rgba(89, 65, 34, 0.12);
  --base-font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  --mono-font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
}

* {
  box-sizing: border-box;
}

html {
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
}

body {
  min-height: 100vh;
  margin: 0;
  background: url("../assets/bg.jpg") left top / 420px auto repeat;
  color: var(--ink);
  font-family: var(--base-font-family);
  letter-spacing: 0;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

a {
  color: var(--accent-strong);
  font-weight: 600;
  text-decoration: none;
}

a:hover {
  color: var(--accent);
}

.article-content a,
.post-list a,
.site-brand {
  background-image: linear-gradient(currentColor, currentColor);
  background-repeat: no-repeat;
  background-position: center calc(100% - 0.08em);
  background-size: 0 1px;
  transition:
    color 140ms ease,
    background-size 180ms ease;
}

.article-content a:hover,
.post-list a:hover,
.site-brand:hover {
  background-size: 100% 1px;
}

.article-content a:has(img) {
  background-image: none;
}

.site-shell {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  min-height: 100vh;
}

.sidebar {
  position: sticky;
  top: 0;
  height: 100vh;
  overflow-y: auto;
  background: var(--sidebar);
  box-shadow: rgba(0, 0, 0, 0.1) 1px 0 3px 0;
  color: var(--sidebar-ink);
  z-index: 20;
}

.sidebar-head {
  position: sticky;
  top: 0;
  z-index: 3;
  padding: 16px 12px 12px;
  background:
    linear-gradient(
      180deg,
      var(--sidebar) 0%,
      rgba(251, 247, 237, 0.98) 78%,
      rgba(251, 247, 237, 0.94) 100%
    );
  box-shadow: 0 10px 14px rgba(251, 247, 237, 0.92);
}

.site-brand {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 6px 12px;
  color: var(--accent-strong);
  font-size: 18px;
  font-weight: 700;
  line-height: 1.2;
}

.site-brand img {
  width: 40px;
  height: 40px;
  flex: 0 0 auto;
  object-fit: contain;
  border-radius: 8px;
}

.site-brand span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-search-form {
  margin: 0 6px 8px;
}

.sidebar-search-field {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  min-height: 32px;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 10px;
  border: 1px solid rgb(228, 218, 209);
  border-radius: 16px;
  background: rgb(252, 252, 252);
  color: rgba(99, 87, 83, 0.68);
  box-shadow: rgba(0, 0, 0, 0.12) 0 1px 4px inset;
  transition:
    border-color 180ms ease,
    box-shadow 180ms ease,
    background 180ms ease;
}

.sidebar-search-field:focus-within {
  border-color: rgb(218, 205, 193);
  background: rgb(252, 252, 252);
  box-shadow:
    rgba(0, 0, 0, 0.12) 0 1px 4px inset,
    0 0 0 2px rgba(145, 104, 71, 0.06);
}

.sidebar-search-icon {
  width: 14px;
  height: 14px;
  flex: 0 0 14px;
  border: 3px solid rgba(99, 87, 83, 0.58);
  border-radius: 50%;
  position: relative;
}

.sidebar-search-icon::after {
  content: "";
  position: absolute;
  width: 7px;
  height: 3px;
  right: -6px;
  bottom: -4px;
  border-radius: 999px;
  background: rgba(99, 87, 83, 0.58);
  transform: rotate(45deg);
  transform-origin: center;
}

.sidebar-search-field input {
  width: 100%;
  min-width: 0;
  flex: 1 1 auto;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--ink);
  font-family: var(--base-font-family);
  font-size: 14px;
  font-weight: 400;
  line-height: 1;
  padding: 0;
}

.sidebar-search-field input::placeholder {
  color: rgba(177, 166, 153, 0.58);
  font-weight: 400;
}

.sidebar-search-field input::-webkit-search-cancel-button,
.sidebar-search-field input::-webkit-search-decoration {
  appearance: none;
  display: none;
}

.sidebar-mode-toggle {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 2px;
  margin: 0 6px;
  padding: 2px;
  border: 1px solid rgba(206, 190, 170, 0.78);
  border-radius: 8px;
  background: rgba(245, 239, 228, 0.72);
}

.sidebar-mode-button {
  min-width: 0;
  min-height: 32px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--sidebar-ink);
  cursor: pointer;
  font-family: var(--base-font-family);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0;
}

.sidebar-mode-button:hover,
.sidebar-mode-button[aria-selected="true"] {
  background: rgb(255, 251, 245);
  color: var(--accent-strong);
  box-shadow: 0 1px 5px rgba(89, 65, 34, 0.1);
}

.sidebar ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.sidebar-nav[hidden] {
  display: none;
}

.sidebar-nav a {
  min-height: 46px;
  display: block;
  border-bottom: 1px solid var(--sidebar-line);
  color: var(--sidebar-ink);
  font-size: 14px;
  line-height: 1.45;
  overflow: hidden;
  padding: 12px 18px 12px 26px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-nav li li a {
  min-height: 42px;
  background: rgba(255, 251, 245, 0.38);
  border-bottom-color: rgba(228, 218, 209, 0.78);
  color: #655044;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.5;
  padding: 10px 16px 10px 38px;
}

.sidebar-nav-sections > ul > li > a {
  min-height: 48px;
  color: #4f392b;
  font-size: 15px;
  font-weight: 700;
}

.sidebar-nav-latest a {
  min-height: 62px;
  padding: 10px 18px 10px 26px;
  white-space: normal;
}

.sidebar-post-meta,
.sidebar-post-title {
  display: block;
  overflow: hidden;
}

.sidebar-post-meta {
  margin-bottom: 4px;
  color: var(--sidebar-muted);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-post-title {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.5;
}

.sidebar-nav a:hover,
.sidebar-nav a.active {
  background: rgb(241, 236, 225);
  color: var(--accent-strong);
  box-shadow: rgba(0, 0, 0, 0.03) 0 1px 4px 0 inset;
}

.site-main {
  min-width: 0;
  padding: 20px 20px 128px;
}

.article-page {
  width: 100%;
}

.reader-sheet {
  position: relative;
  width: min(920px, 100%);
  min-height: max-content;
  margin: 0 auto 24px;
  padding: 72px 64px 68px;
  overflow: hidden;
  background: var(--paper);
  box-shadow: var(--sheet-shadow);
}

.article-toc {
  position: fixed;
  top: 24px;
  right: 22px;
  z-index: 12;
  width: 236px;
  max-height: calc(100vh - 48px);
  overflow: auto;
  border: 1px solid rgba(206, 190, 170, 0.78);
  border-radius: 8px;
  background: rgba(255, 250, 242, 0.94);
  box-shadow: 0 16px 32px rgba(89, 65, 34, 0.12);
  padding: 14px 0 12px;
}

.article-toc-title {
  margin: 0 16px 10px;
  color: var(--accent-strong);
  font-size: 14px;
  font-weight: 700;
  line-height: 1.2;
}

.article-toc nav,
.article-toc ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.article-toc li {
  margin: 0;
  padding: 0;
}

.article-toc a {
  display: block;
  border-left: 2px solid transparent;
  color: rgba(99, 87, 83, 0.78);
  font-size: 13px;
  font-weight: 500;
  line-height: 1.45;
  padding: 7px 16px 7px 18px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.article-toc-root a {
  color: var(--accent-strong);
  font-weight: 700;
}

.article-toc li li a {
  color: rgba(99, 87, 83, 0.62);
  font-size: 12px;
  font-weight: 400;
  padding-left: 30px;
}

.article-toc a:hover {
  border-left-color: rgba(143, 92, 44, 0.42);
  background: rgba(241, 236, 225, 0.64);
  color: var(--accent-strong);
}

.article-toc a.is-active {
  border-left-color: var(--accent);
  background: rgba(241, 236, 225, 0.82);
  color: var(--accent-strong);
  font-weight: 700;
}

.reader-sheet::before,
.reader-sheet::after {
  content: "";
  position: absolute;
  pointer-events: none;
  border: 1px solid var(--frame);
}

.reader-sheet::before {
  inset: 8px;
}

.reader-sheet::after {
  inset: 13px;
}

.reader-sheet-corner {
  position: absolute;
  width: 5px;
  height: 5px;
  border: 1px solid rgba(237, 233, 225, 0.76);
  pointer-events: none;
}

.reader-sheet-corner-top-left {
  left: 5px;
  top: 5px;
}

.reader-sheet-corner-top-right {
  right: 5px;
  top: 5px;
}

.reader-sheet-corner-bottom-left {
  left: 5px;
  bottom: 5px;
}

.reader-sheet-corner-bottom-right {
  right: 5px;
  bottom: 5px;
}

.article-header {
  position: relative;
  z-index: 1;
  margin-bottom: 32px;
}

.article-header h1 {
  margin: 0 0 12px;
  color: var(--ink);
  font-size: 34px;
  line-height: 1.3;
}

.article-header time {
  color: var(--muted);
  font-size: 14px;
}

.article-content {
  position: relative;
  z-index: 1;
  color: var(--ink);
  font-size: 17px;
  line-height: 1.9;
}

.article-content h1,
.article-content h2,
.article-content h3,
.article-content h4 {
  color: var(--ink);
  line-height: 1.35;
}

.article-content h1 {
  font-size: 34px;
}

.article-content h2 {
  margin-top: 42px;
  font-size: 26px;
}

.article-content h3 {
  margin-top: 32px;
  font-size: 21px;
}

.article-content p,
.article-content ul,
.article-content ol,
.article-content blockquote,
.article-content table,
.article-content pre {
  margin-bottom: 20px;
}

.article-content table {
  display: block;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
}

.article-content th,
.article-content td {
  border-bottom: 1px solid rgba(206, 190, 170, 0.62);
  padding: 8px 10px;
  text-align: left;
  vertical-align: top;
}

.article-content img {
  max-width: 100%;
  height: auto;
  border-radius: 7px;
}

.article-content code {
  border-radius: 4px;
  background: rgba(102, 76, 49, 0.08);
  color: #69451f;
  font-family: var(--mono-font-family);
  font-size: 0.92em;
  padding: 0.15em 0.35em;
}

.article-content pre {
  position: relative;
  overflow-x: auto;
  border-radius: 7px;
  background: rgba(102, 76, 49, 0.08);
  padding: 46px 18px 18px;
}

.article-content pre code {
  background: transparent;
  padding: 0;
}

.code-copy-button {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 2;
  min-height: 28px;
  border: 1px solid rgba(206, 190, 170, 0.78);
  border-radius: 6px;
  background: rgb(255, 251, 245);
  color: var(--accent-strong);
  cursor: pointer;
  font-family: var(--base-font-family);
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  padding: 0 10px;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.72),
    0 1px 4px rgba(89, 65, 34, 0.08);
  transition:
    background 140ms ease,
    border-color 140ms ease,
    color 140ms ease;
}

.code-copy-button:hover {
  border-color: rgba(143, 92, 44, 0.34);
  background: rgb(250, 246, 238);
}

.code-copy-button.is-copied {
  color: #4f7a32;
}

.code-copy-button.is-failed {
  color: #9a4f2f;
}

.article-content blockquote {
  margin-left: 0;
  border-left: 4px solid rgba(143, 92, 44, 0.28);
  color: rgba(63, 47, 34, 0.8);
  padding-left: 18px;
}

.post-list {
  position: relative;
  z-index: 1;
  margin: 0;
  padding: 0;
  list-style: none;
}

.post-list li {
  display: flex;
  gap: 16px;
  justify-content: space-between;
  border-bottom: 1px solid rgba(206, 190, 170, 0.72);
  padding: 14px 0;
}

.post-list time {
  flex: 0 0 auto;
  color: var(--muted);
  font-size: 14px;
}

.search-sheet {
  width: min(920px, 100%);
  padding: 64px 72px 72px;
}

.search-sheet .article-header {
  margin-bottom: 28px;
}

.search-sheet .article-header h1 {
  font-size: 34px;
}

.search-page {
  max-width: none;
  margin: 0;
}

.search-page-form {
  position: relative;
  z-index: 3;
  margin: 0 0 28px;
}

.search-page-field {
  width: 100%;
  min-height: 42px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  border: 1px solid rgb(228, 218, 209);
  border-radius: 8px;
  background: rgb(255, 253, 248);
  color: rgba(99, 87, 83, 0.68);
  box-shadow:
    rgba(89, 65, 34, 0.06) 0 1px 3px inset,
    rgba(255, 255, 255, 0.72) 0 1px 0;
}

.search-page-field:focus-within {
  border-color: rgb(218, 205, 193);
  box-shadow:
    rgba(89, 65, 34, 0.08) 0 1px 4px inset,
    0 0 0 2px rgba(145, 104, 71, 0.06);
}

.search-page-icon {
  width: 13px;
  height: 13px;
  flex: 0 0 13px;
  border: 2px solid rgba(99, 87, 83, 0.5);
  border-radius: 50%;
  box-shadow: 5px 5px 0 -4px rgba(99, 87, 83, 0.5);
  transform: rotate(-8deg);
}

.search-page-field input {
  width: 100%;
  min-width: 0;
  flex: 1 1 auto;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--ink);
  font-family: var(--base-font-family);
  font-size: 15px;
  font-weight: 400;
  line-height: 40px;
  padding: 0;
}

.search-page-field input::placeholder {
  color: rgba(177, 166, 153, 0.58);
  font-weight: 400;
}

.search-page-field input::-webkit-search-cancel-button,
.search-page-field input::-webkit-search-decoration {
  appearance: none;
  display: none;
}

.search-status {
  min-height: 42px;
  display: flex;
  align-items: center;
  border-bottom: 1px solid rgba(206, 190, 170, 0.64);
  color: rgba(99, 87, 83, 0.72);
  font-size: 14px;
  font-weight: 700;
  margin: 0 0 4px;
  padding: 0;
}

.search-results {
  margin: 0;
  padding: 0;
  list-style: none;
}

.search-result {
  border-bottom: 1px solid rgba(206, 190, 170, 0.64);
  padding: 22px 0;
}

.search-result:last-child {
  border-bottom: 1px solid rgba(206, 190, 170, 0.64);
}

.search-result-title {
  display: inline;
  color: var(--accent-strong);
  font-size: 18px;
  font-weight: 700;
  line-height: 1.45;
}

.search-result-excerpt {
  color: rgba(63, 47, 34, 0.82);
  font-size: 15px;
  line-height: 1.8;
  margin: 8px 0 0;
  overflow-wrap: anywhere;
}

.home-description {
  margin: 0;
  color: var(--muted);
  font-size: 16px;
  line-height: 1.8;
}

.home-list-title {
  position: relative;
  z-index: 1;
  margin: 34px 0 2px;
  color: var(--muted);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.article-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 14px;
  color: var(--muted);
  font-size: 14px;
}

.article-categories {
  color: var(--muted);
}

.image-unavailable {
  display: inline-block;
  border: 1px dashed rgba(143, 92, 44, 0.42);
  border-radius: 6px;
  color: var(--muted);
  font-size: 14px;
  padding: 6px 10px;
}

.site-nav-toggle,
.site-nav-button {
  display: none;
}

@media (max-width: 768px) {
  .site-shell {
    display: block;
  }

  .site-nav-button {
    position: fixed;
    z-index: 40;
    top: 11px;
    left: 18px;
    width: 40px;
    height: 40px;
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(82, 63, 47, 0.52);
    background: rgb(255, 250, 243);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.28),
      0 2px 10px rgba(42, 29, 19, 0.2);
    cursor: pointer;
    gap: 5px;
    transition:
      left 180ms ease,
      border-color 180ms ease,
      background 180ms ease;
  }

  .site-nav-button span {
    display: block;
    width: 18px;
    height: 2px;
    border-radius: 999px;
    background: #5a3214;
    transition:
      opacity 160ms ease,
      transform 180ms ease;
    transform-origin: center;
  }

  .site-nav-toggle:checked + .site-nav-button {
    left: 248px;
    border-color: rgba(143, 92, 44, 0.68);
    background: rgb(255, 247, 235);
  }

  .site-nav-toggle:checked + .site-nav-button span:nth-child(1) {
    transform: translateY(7px) rotate(45deg);
  }

  .site-nav-toggle:checked + .site-nav-button span:nth-child(2) {
    opacity: 0;
  }

  .site-nav-toggle:checked + .site-nav-button span:nth-child(3) {
    transform: translateY(-7px) rotate(-45deg);
  }

  .sidebar {
    position: fixed;
    left: -300px;
    width: 300px;
    transition: left 180ms ease;
  }

  .site-nav-toggle:checked ~ .site-shell .sidebar {
    left: 0;
  }

  .site-main {
    padding: 64px 12px 72px;
  }

  .reader-sheet {
    padding: 42px 22px 48px;
  }

  .article-header h1,
  .article-content h1 {
    font-size: 26px;
  }

  .article-content {
    font-size: 16px;
  }

  .post-list li {
    display: block;
  }

  .post-list time {
    display: block;
    margin-top: 4px;
  }
}

@media (min-width: 1560px) {
  .article-page.has-toc {
    padding-right: 280px;
  }
}

@media (max-width: 1559px) {
  .article-toc {
    display: none;
  }
}
`,
    "assets/js/sidebar.js": `(function () {
  var scrollStorageKey = "notes-site-sidebar-scroll";
  var modeStorageKey = "notes-site-sidebar-mode";
  var defaultMode = "latest";

  function isVisibleInside(container, element) {
    var containerRect = container.getBoundingClientRect();
    var elementRect = element.getBoundingClientRect();
    var padding = 16;

    return (
      elementRect.top >= containerRect.top + padding &&
      elementRect.bottom <= containerRect.bottom - padding
    );
  }

  function keepActiveLinkVisible(sidebar) {
    var activeLink = Array.prototype.slice
      .call(sidebar.querySelectorAll(".sidebar-nav a.active"))
      .find(function (link) {
        return !link.closest("[hidden]");
      });

    if (!activeLink || isVisibleInside(sidebar, activeLink)) {
      return;
    }

    activeLink.scrollIntoView({
      block: "center",
      inline: "nearest",
    });
  }

  function setupSidebarMode(sidebar) {
    var buttons = Array.prototype.slice.call(sidebar.querySelectorAll("[data-sidebar-mode-button]"));
    var panels = Array.prototype.slice.call(sidebar.querySelectorAll("[data-sidebar-panel]"));

    if (buttons.length === 0 || panels.length === 0) {
      return;
    }

    function knownMode(mode) {
      return panels.some(function (panel) {
        return panel.dataset.sidebarPanel === mode;
      });
    }

    function setMode(mode, shouldSave) {
      var nextMode = knownMode(mode) ? mode : defaultMode;

      panels.forEach(function (panel) {
        panel.hidden = panel.dataset.sidebarPanel !== nextMode;
      });

      buttons.forEach(function (button) {
        var isActive = button.dataset.sidebarModeButton === nextMode;
        button.setAttribute("aria-selected", String(isActive));
      });

      if (shouldSave) {
        window.localStorage.setItem(modeStorageKey, nextMode);
      }

      window.requestAnimationFrame(function () {
        keepActiveLinkVisible(sidebar);
      });
    }

    var savedMode = window.localStorage.getItem(modeStorageKey);
    setMode(savedMode || defaultMode, false);

    buttons.forEach(function (button) {
      button.addEventListener("click", function () {
        setMode(button.dataset.sidebarModeButton, true);
      });
    });
  }

  function setupArticleToc() {
    var toc = document.querySelector(".article-toc");
    var links = toc ? Array.prototype.slice.call(toc.querySelectorAll("a[href^='#']")) : [];

    if (!toc || links.length === 0) {
      return;
    }

    var headings = links
      .map(function (link) {
        var id = decodeURIComponent(link.hash.slice(1));
        var heading = document.getElementById(id);

        return heading ? { heading: heading, link: link } : null;
      })
      .filter(Boolean);

    function setActive(link) {
      links.forEach(function (item) {
        item.classList.toggle("is-active", item === link);
      });

      if (!isVisibleInside(toc, link)) {
        link.scrollIntoView({
          block: "nearest",
          inline: "nearest",
        });
      }
    }

    function syncActiveLink() {
      var current = headings[0];
      var offset = 96;

      headings.forEach(function (item) {
        if (item.heading.getBoundingClientRect().top <= offset) {
          current = item;
        }
      });

      if (current) {
        setActive(current.link);
      }
    }

    syncActiveLink();
    window.addEventListener("scroll", syncActiveLink, { passive: true });
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }

    return new Promise(function (resolve, reject) {
      var textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "0";
      document.body.appendChild(textarea);
      textarea.select();

      try {
        var succeeded = document.execCommand("copy");
        document.body.removeChild(textarea);
        succeeded ? resolve() : reject(new Error("Copy command failed"));
      } catch (error) {
        document.body.removeChild(textarea);
        reject(error);
      }
    });
  }

  function setupCodeCopyButtons() {
    var codeBlocks = Array.prototype.slice.call(document.querySelectorAll(".article-content pre > code"));

    codeBlocks.forEach(function (code) {
      var pre = code.parentElement;

      if (!pre || pre.querySelector(".code-copy-button")) {
        return;
      }

      pre.classList.add("code-block-with-copy");

      var button = document.createElement("button");
      button.type = "button";
      button.className = "code-copy-button";
      button.textContent = "复制";
      button.setAttribute("aria-label", "复制代码");

      button.addEventListener("click", function () {
        var originalText = button.textContent;

        copyText(code.textContent || "")
          .then(function () {
            button.textContent = "已复制";
            button.classList.add("is-copied");
          })
          .catch(function () {
            button.textContent = "手动复制";
            button.classList.add("is-failed");
          })
          .finally(function () {
            window.setTimeout(function () {
              button.textContent = originalText;
              button.classList.remove("is-copied", "is-failed");
            }, 1600);
          });
      });

      pre.appendChild(button);
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    var sidebar = document.querySelector(".sidebar");

    if (!sidebar) {
      return;
    }

    setupSidebarMode(sidebar);

    var savedScroll = window.sessionStorage.getItem(scrollStorageKey);
    if (savedScroll !== null) {
      sidebar.scrollTop = parseInt(savedScroll, 10) || 0;
      window.sessionStorage.removeItem(scrollStorageKey);
    }

    window.requestAnimationFrame(function () {
      keepActiveLinkVisible(sidebar);
    });

    sidebar.querySelectorAll(".sidebar-nav a[href]").forEach(function (link) {
      link.addEventListener("click", function () {
        window.sessionStorage.setItem(scrollStorageKey, String(sidebar.scrollTop));
      });
    });

    setupArticleToc();
    setupCodeCopyButtons();
  });
})();
`,
    "static/js/search.js": `(function () {
  "use strict";

  var script = document.querySelector("script[data-search-index]");
  var indexUrl = script ? script.getAttribute("data-search-index") : "";
  var form = document.querySelector(".search-page-form");
  var input = document.getElementById("search-page-input");
  var statusNode = document.getElementById("search-status");
  var resultsNode = document.getElementById("search-results");

  if (!input || !statusNode || !resultsNode || !indexUrl) {
    return;
  }

  var entries = null;
  var pendingQuery = "";
  var timer = 0;
  var RESULT_LIMIT = 50;

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\\s+/g, " ")
      .trim();
  }

  function clearNode(node) {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  function buildEntries(payload) {
    var pages = Array.isArray(payload) ? payload : (payload && payload.pages) || [];

    return pages
      .map(function (page) {
        var title = String(page.title || "未命名");
        var text = String(page.text || "").replace(/\\s+/g, " ").trim();
        var permalink = String(page.permalink || "");
        var titleLower = normalize(title);

        return {
          title: title,
          text: text,
          permalink: permalink,
          titleLower: titleLower,
          haystack: normalize(title + " " + text),
        };
      })
      .filter(function (entry) {
        return entry.permalink.length > 0;
      });
  }

  function makeTerms(query) {
    var normalized = normalize(query);
    return normalized ? normalized.split(" ") : [];
  }

  function matches(entry, terms) {
    for (var index = 0; index < terms.length; index += 1) {
      if (entry.haystack.indexOf(terms[index]) === -1) {
        return false;
      }
    }

    return true;
  }

  function score(entry, terms) {
    var total = 0;

    for (var index = 0; index < terms.length; index += 1) {
      var term = terms[index];

      if (entry.titleLower.indexOf(term) !== -1) {
        total += 12;
      }

      var at = entry.haystack.indexOf(term);
      var hits = 0;

      while (at !== -1 && hits < 20) {
        total += 1;
        hits += 1;
        at = entry.haystack.indexOf(term, at + term.length);
      }
    }

    return total;
  }

  function excerpt(entry, terms) {
    var text = entry.text;

    if (!text) {
      return "";
    }

    var lower = text.toLowerCase();
    var best = -1;

    for (var index = 0; index < terms.length; index += 1) {
      var at = lower.indexOf(terms[index]);

      if (at !== -1 && (best === -1 || at < best)) {
        best = at;
      }
    }

    if (best === -1) {
      return text.length > 160 ? text.slice(0, 160) + "…" : text;
    }

    var start = Math.max(0, best - 40);
    var end = Math.min(text.length, start + 180);

    return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
  }

  function renderResults(list, terms) {
    clearNode(resultsNode);

    var fragment = document.createDocumentFragment();

    list.forEach(function (entry) {
      var item = document.createElement("li");
      item.className = "search-result";

      var link = document.createElement("a");
      link.className = "search-result-title";
      link.href = entry.permalink;
      link.textContent = entry.title;
      item.appendChild(link);

      var snippet = excerpt(entry, terms);

      if (snippet) {
        var paragraph = document.createElement("p");
        paragraph.className = "search-result-excerpt";
        paragraph.textContent = snippet;
        item.appendChild(paragraph);
      }

      fragment.appendChild(item);
    });

    resultsNode.appendChild(fragment);
  }

  function syncUrl(query) {
    if (!window.history || !window.history.replaceState) {
      return;
    }

    try {
      var url = new URL(window.location.href);

      if (query) {
        url.searchParams.set("q", query);
      } else {
        url.searchParams.delete("q");
      }

      window.history.replaceState(null, "", url.toString());
    } catch (error) {
      /* URL 不可变更时忽略，搜索结果本身不受影响。 */
    }
  }

  function run(query) {
    if (!entries) {
      return;
    }

    var terms = makeTerms(query);
    clearNode(resultsNode);

    if (terms.length === 0) {
      statusNode.textContent = entries.length
        ? "共 " + entries.length + " 篇文章，输入关键字开始搜索。"
        : "搜索索引为空。";
      return;
    }

    var found = entries.filter(function (entry) {
      return matches(entry, terms);
    });

    found.sort(function (left, right) {
      return score(right, terms) - score(left, terms);
    });

    renderResults(found.slice(0, RESULT_LIMIT), terms);

    if (found.length === 0) {
      statusNode.textContent = "没有找到相关内容。";
    } else if (found.length > RESULT_LIMIT) {
      statusNode.textContent = "共找到 " + found.length + " 篇文章，显示前 " + RESULT_LIMIT + " 篇。";
    } else {
      statusNode.textContent = "共找到 " + found.length + " 篇文章。";
    }
  }

  function start() {
    var initialQuery = "";

    try {
      initialQuery = new URLSearchParams(window.location.search).get("q") || "";
    } catch (error) {
      initialQuery = "";
    }

    input.value = initialQuery;
    pendingQuery = initialQuery;
    statusNode.textContent = "正在加载搜索索引…";

    if (!window.fetch || !window.Promise) {
      statusNode.textContent = "当前浏览器不支持站内搜索，请升级浏览器。";
      return;
    }

    window
      .fetch(indexUrl, { credentials: "same-origin" })
      .then(function (response) {
        if (!response.ok) {
          throw new Error("HTTP " + response.status);
        }

        return response.json();
      })
      .then(function (payload) {
        entries = buildEntries(payload);
        run(pendingQuery);
      })
      .catch(function () {
        statusNode.textContent = "搜索索引加载失败，请稍后重试。";
      });
  }

  input.addEventListener("input", function () {
    window.clearTimeout(timer);
    timer = window.setTimeout(function () {
      pendingQuery = input.value;
      syncUrl(pendingQuery);
      run(pendingQuery);
    }, 120);
  });

  if (form) {
    form.addEventListener("submit", function () {
      pendingQuery = input.value;
      syncUrl(pendingQuery);
    });
  }

  start();
})();
`,
  },
};

export function getSiteThemeFiles(themeId: string = SITE_THEME_ID): Record<string, string> {
  const files = SITE_THEME_FILES[themeId];
  if (!files) throw new Error(`不支持的网站样式：${themeId}`);
  return { ...files };
}
