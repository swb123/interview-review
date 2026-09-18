#!/usr/bin/env python3
"""解析语雀面试知识库文章为 Q&A JSON 题库

数据源: ~/interview-review/articles/*.md（从语雀 get_doc 拉取的 markdown）
特性:
  1. HTML 表格 → markdown 表格（保留表头分隔行，行间无空行）
  2. markdown 表格规范化（补分隔行、合并被拆散的行）
  3. 代码围栏修复（裸 Java 代码补围栏）
  4. 列表/加粗标签归一化
  5. 兼容无冒号的 Q 标题（如 "Q13（新增 — MySQL 8.0 新特性）"）
输出: ~/interview-review/questions.json
"""
import json
import re
import os
import html as html_mod

ARTICLES = [
    ("一、Java核心", "01_java.md"),
    ("二、JVM调优", "02_jvm.md"),
    ("三、并发编程", "03_concurrent.md"),
    ("四、数据库", "04_db.md"),
    ("五、缓存", "05_cache.md"),
    ("六、消息队列", "06_mq.md"),
    ("七、微服务", "07_spring.md"),
    ("八、分布式", "08_distributed.md"),
    ("九、系统设计", "09_sysdesign.md"),
    ("十、编码算法", "10_coding.md"),
]

ARTICLES_DIR = os.path.expanduser("~/interview-review/articles")
OUT_PATH = os.path.expanduser("~/interview-review/questions.json")
MAX_ANSWER = 20000  # 单题答案上限（当前最长答案约 13K）


# ---------------------------------------------------------------------------
# 1. HTML 表格 → markdown 表格
# ---------------------------------------------------------------------------

def _cell_to_md(td: str) -> str:
    t = re.sub(r'<[^>]+>', '', td)          # 去掉所有标签（strong/code/sub 等）
    t = html_mod.unescape(t)                 # &lt; &gt; &amp; ...
    t = t.replace('\n', ' ').strip()
    t = re.sub(r'\s+', ' ', t)
    t = t.replace('|', '\\|')
    return t

def _table_to_md(tbl: str) -> str:
    rows = re.findall(r'<tr[^>]*>(.*?)</tr>', tbl, re.S)
    out = []
    for ri, row in enumerate(rows):
        cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.S)
        if not cells:
            continue
        out.append('| ' + ' | '.join(_cell_to_md(c) for c in cells) + ' |')
        if ri == 0:
            out.append('|' + '---|' * len(cells))
    return '\n'.join(out)

def html_tables_to_markdown(text: str) -> str:
    """把语雀 markdown 导出里的 HTML 表格转成 markdown 表格"""
    return re.sub(r'<table>.*?</table>', lambda m: _table_to_md(m.group(0)),
                  text, flags=re.S)


# ---------------------------------------------------------------------------
# 2. markdown 表格规范化（补分隔行、合并被空行拆散的行）
# ---------------------------------------------------------------------------

def _is_table_row(line: str) -> bool:
    s = line.strip()
    return s.startswith('|') and s.endswith('|')

def _is_separator(line: str) -> bool:
    s = line.strip()
    if not (s.startswith('|') and s.endswith('|')):
        return False
    inner = s[1:-1].replace(':', '').replace('-', '').replace(' ', '').replace('|', '')
    return inner == '' and '-' in s

def _make_separator(row: str) -> str:
    n = row.count('|') - 1
    return '|' + '---|' * n

def normalize_markdown_tables(text: str) -> str:
    """仅在代码围栏外处理表格行"""
    lines = text.split('\n')
    out = []
    i = 0
    in_fence = False
    while i < len(lines):
        line = lines[i]
        if line.strip().startswith('```'):
            in_fence = not in_fence
            out.append(line)
            i += 1
            continue
        if in_fence:
            out.append(line)
            i += 1
            continue

        if _is_table_row(line):
            # 收集连续表格行（容忍中间夹一个空行）
            block = []
            j = i
            while j < len(lines):
                l = lines[j]
                if _is_table_row(l):
                    block.append(l.strip())
                    j += 1
                elif l.strip() == '' and j + 1 < len(lines) and _is_table_row(lines[j + 1]):
                    j += 1  # 跳过表格行之间的空行
                else:
                    break
            # 规范化：第一行是表头；若无分隔行则插入
            if block:
                if len(block) > 1 and not _is_separator(block[1]):
                    block.insert(1, _make_separator(block[0]))
                elif len(block) == 1 and '---' not in block[0]:
                    block.insert(1, _make_separator(block[0]))
                out.extend(block)
            i = j
            continue

        out.append(line)
        i += 1
    return '\n'.join(out)


# ---------------------------------------------------------------------------
# 3. 列表与残留 HTML 标签归一化
# ---------------------------------------------------------------------------

def normalize_lists(text: str) -> str:
    # + <strong>x</strong>: ... → - **x**: ...
    text = re.sub(r'^\+\s+<strong>(.*?)</strong>', r'- **\1**', text, flags=re.M)
    # 残留裸 <strong>/<sub>/<sup> 标签 → markdown/纯文本
    text = re.sub(r'<strong>(.*?)</strong>', r'**\1**', text)
    text = re.sub(r'<sub>(.*?)</sub>', r'\1', text)
    text = re.sub(r'<sup>(.*?)</sup>', r'\1', text)
    # 语雀导出的 {id="xxx"} 标题锚点 → 去掉
    text = re.sub(r'\s*\{id="[^"]*"\}', '', text)
    return text


# ---------------------------------------------------------------------------
# 4. 代码围栏修复（裸代码补 ```java 围栏）
# ---------------------------------------------------------------------------

def fix_code_fences(text: str) -> str:
    fenced_blocks = []
    fence_pattern = re.compile(r'```[a-zA-Z]*\n([\s\S]*?)```', re.MULTILINE)

    def protect(m):
        fenced_blocks.append(m.group(0))
        return f'FENCE{len(fenced_blocks)-1}'

    protected = fence_pattern.sub(protect, text)

    lines = protected.split('\n')
    result = []
    in_code = False
    code_lines = []
    brace_depth = 0

    start_patterns = [
        r'^(public|private|protected|static|final|synchronized|@Override|@Component|@sun\.misc)\s',
        r'^(class|interface|record|enum)\s+\w+',
        r'^(ListNode|TreeNode|Map<|List<|Deque<|Queue<|PriorityQueue<|LinkedList<|ArrayList<|HashSet<|int\[\])\w*[\s<]',
    ]

    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if not in_code:
            is_code_start = False
            if re.match(start_patterns[0], stripped) and '{' in line:
                is_code_start = True
            elif re.match(start_patterns[1], stripped) and '{' in line:
                is_code_start = True
            elif re.match(start_patterns[2], stripped) and ('{' in line or '(' in line):
                is_code_start = True
            elif stripped.startswith('//') and i + 1 < len(lines):
                next_stripped = lines[i + 1].strip()
                if (re.match(start_patterns[0], next_stripped)
                        or re.match(start_patterns[1], next_stripped)
                        or re.match(start_patterns[2], next_stripped)):
                    is_code_start = True

            if is_code_start:
                in_code = True
                code_lines = [line]
                brace_depth = line.count('{') - line.count('}')
                i += 1
                continue
            result.append(line)
        else:
            code_lines.append(line)
            brace_depth += line.count('{') - line.count('}')
            if brace_depth <= 0 and '}' in line:
                result.append('```java')
                result.append('\n'.join(code_lines).rstrip())
                result.append('```')
                in_code = False
                code_lines = []
                brace_depth = 0
        i += 1

    if in_code:
        result.append('```java')
        result.append('\n'.join(code_lines).rstrip())
        result.append('```')

    text = '\n'.join(result)

    for idx, block in enumerate(fenced_blocks):
        text = text.replace(f'FENCE{idx}', block)

    return text


# ---------------------------------------------------------------------------
# 5. 单篇文章解析
# ---------------------------------------------------------------------------

Q_HEADING = re.compile(
    r'^#{2,3}\s+(Q\d+(?:\.\d+)?|题型[一二三四五六七八九十\d]+)'
    r'(?:（([^）]*)）)?(?:[：:]\s*(.*))?$',
    re.MULTILINE
)

def parse_article(category: str, filename: str) -> list:
    path = os.path.join(ARTICLES_DIR, filename)
    if not os.path.exists(path):
        print(f"  ⚠️ 文件不存在: {path}")
        return []

    with open(path, encoding='utf-8') as f:
        content = f.read()

    # 预处理
    content = html_tables_to_markdown(content)
    content = normalize_lists(content)
    content = normalize_markdown_tables(content)
    content = fix_code_fences(content)

    matches = list(Q_HEADING.finditer(content))
    # 非 Q 的二级标题（如「面试STAR」「扩展阅读」）是文章附录，不属于上一题答案
    nonq_h2 = [m.start() for m in re.finditer(
        r'^##\s+(?!Q\d|题型[一二三四五六七八九十\d])', content, re.MULTILINE)]
    questions = []
    for i, m in enumerate(matches):
        num = m.group(1)
        suffix = m.group(2)
        title = (m.group(3) or '').strip()

        if not title:
            title = suffix or num
        elif suffix and suffix not in title:
            # 标题带 （新增/场景题） 等标注时合并进问题文本
            title = f"{title}（{suffix}）" if num.startswith('Q') else title

        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(content)
        # 答案在遇到下一个非 Q 二级标题处截断（附录不并入答案）
        for np in nonq_h2:
            if start < np < end:
                end = np
                break

        answer_raw = content[start:end]
        answer_raw = re.sub(r'^\s*\**A[：:]\**\s*', '', answer_raw)
        answer_raw = re.sub(r'\n{3,}', '\n\n', answer_raw).strip()
        answer_raw = re.sub(r'(\n\s*---\s*)+$', '', answer_raw).strip()

        if len(title) < 3 or len(answer_raw) < 10:
            continue

        questions.append({
            "id": f"{category}-{num}",
            "category": category,
            "number": num,
            "question": title,
            "answer": answer_raw[:MAX_ANSWER],
        })

    return questions


def main():
    all_questions = []
    print("解析文章中...")
    for category, filename in ARTICLES:
        qs = parse_article(category, filename)
        all_questions.extend(qs)
        print(f"  ✅ {category}: {len(qs)} 题")

    # 去重
    seen = set()
    unique = []
    for q in all_questions:
        key = q["question"][:50]
        if key not in seen:
            seen.add(key)
            unique.append(q)

    # 校验
    bad_fences = []
    bad_tables = []
    for q in unique:
        if q["answer"].count('```') % 2 != 0:
            bad_fences.append(q["number"])
        # 表格行之间不应有空行
        if re.search(r'\|\s*[^\n|]+\s*\|\n\n\|', q["answer"]):
            bad_tables.append(q["number"])

    output = {
        "version": "1.1",
        "total": len(unique),
        "questions": unique,
    }

    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\n总计: {len(unique)} 题（去重后）")
    print(f"围栏不配对: {bad_fences if bad_fences else '无 ✅'}")
    print(f"表格行间有空行: {bad_tables if bad_tables else '无 ✅'}")
    print(f"输出: {OUT_PATH}")


if __name__ == "__main__":
    main()
