(function () {
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
      .replace(/\s+/g, " ")
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
        var text = String(page.text || "").replace(/\s+/g, " ").trim();
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
