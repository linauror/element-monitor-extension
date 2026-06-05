// Code Editor Component for Element Monitor extension
// Shared between popup and picker dialog
// Provides: line numbers, syntax highlighting, format button, collapsible section

(function () {
  'use strict';

  // Syntax highlighting tokens
  const KEYWORDS = new Set([
    'var', 'let', 'const', 'function', 'return', 'if', 'else', 'for', 'while', 'do',
    'switch', 'case', 'break', 'continue', 'new', 'this', 'class', 'extends', 'super',
    'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'in', 'of',
    'async', 'await', 'yield', 'import', 'export', 'default', 'from',
    'with', 'debugger', 'void', 'delete'
  ]);
  const BOOLEANS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity']);

  // Tokenize and highlight JavaScript code
  function highlight(code) {
    let result = '';
    let i = 0;
    const len = code.length;

    while (i < len) {
      // Block comment
      if (code[i] === '/' && code[i + 1] === '*') {
        let end = code.indexOf('*/', i + 2);
        if (end === -1) end = len - 2;
        const text = code.slice(i, end + 2);
        result += `<span class="ce-comment">${escapeHtml(text)}</span>`;
        i = end + 2;
        continue;
      }

      // Line comment
      if (code[i] === '/' && code[i + 1] === '/') {
        let end = code.indexOf('\n', i);
        if (end === -1) end = len;
        const text = code.slice(i, end);
        result += `<span class="ce-comment">${escapeHtml(text)}</span>`;
        i = end;
        continue;
      }

      // Template literal
      if (code[i] === '`') {
        let j = i + 1;
        let text = '`';
        while (j < len) {
          if (code[j] === '\\') {
            text += code[j] + (code[j + 1] || '');
            j += 2;
          } else if (code[j] === '`') {
            text += '`';
            j++;
            break;
          } else {
            text += code[j];
            j++;
          }
        }
        result += `<span class="ce-string">${escapeHtml(text)}</span>`;
        i = j;
        continue;
      }

      // String (single or double quote)
      if (code[i] === '"' || code[i] === "'") {
        const quote = code[i];
        let j = i + 1;
        let text = quote;
        while (j < len) {
          if (code[j] === '\\') {
            text += code[j] + (code[j + 1] || '');
            j += 2;
          } else if (code[j] === quote) {
            text += quote;
            j++;
            break;
          } else {
            text += code[j];
            j++;
          }
        }
        result += `<span class="ce-string">${escapeHtml(text)}</span>`;
        i = j;
        continue;
      }

      // Number
      if (/[0-9]/.test(code[i]) && (i === 0 || !/[\w$]/.test(code[i - 1]))) {
        let j = i;
        if (code[j] === '0' && (code[j + 1] === 'x' || code[j + 1] === 'X')) {
          j += 2;
          while (j < len && /[0-9a-fA-F]/.test(code[j])) j++;
        } else {
          while (j < len && /[0-9.]/.test(code[j])) j++;
          if (j < len && (code[j] === 'e' || code[j] === 'E')) {
            j++;
            if (j < len && (code[j] === '+' || code[j] === '-')) j++;
            while (j < len && /[0-9]/.test(code[j])) j++;
          }
        }
        result += `<span class="ce-number">${escapeHtml(code.slice(i, j))}</span>`;
        i = j;
        continue;
      }

      // Identifier / keyword
      if (/[a-zA-Z_$]/.test(code[i])) {
        let j = i;
        while (j < len && /[\w$]/.test(code[j])) j++;
        const word = code.slice(i, j);
        if (KEYWORDS.has(word)) {
          result += `<span class="ce-keyword">${escapeHtml(word)}</span>`;
        } else if (BOOLEANS.has(word)) {
          result += `<span class="ce-boolean">${escapeHtml(word)}</span>`;
        } else {
          result += escapeHtml(word);
        }
        i = j;
        continue;
      }

      // Default character
      result += escapeHtml(code[i]);
      i++;
    }

    return result;
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Lightweight JS formatter
  function formatJS(code) {
    if (!code || !code.trim()) return '';

    // Tokenize
    const tokens = [];
    let i = 0;
    const len = code.length;

    while (i < len) {
      // Whitespace
      if (/\s/.test(code[i])) {
        let j = i;
        while (j < len && /\s/.test(code[j])) j++;
        tokens.push({ type: 'ws', value: code.slice(i, j) });
        i = j;
        continue;
      }

      // Block comment
      if (code[i] === '/' && code[i + 1] === '*') {
        let end = code.indexOf('*/', i + 2);
        if (end === -1) end = len - 2;
        tokens.push({ type: 'comment', value: code.slice(i, end + 2) });
        i = end + 2;
        continue;
      }

      // Line comment
      if (code[i] === '/' && code[i + 1] === '/') {
        let end = code.indexOf('\n', i);
        if (end === -1) end = len;
        tokens.push({ type: 'comment', value: code.slice(i, end) });
        i = end;
        continue;
      }

      // String
      if (code[i] === '"' || code[i] === "'" || code[i] === '`') {
        const quote = code[i];
        let j = i + 1;
        while (j < len) {
          if (code[j] === '\\') { j += 2; continue; }
          if (code[j] === quote) { j++; break; }
          j++;
        }
        tokens.push({ type: 'string', value: code.slice(i, j) });
        i = j;
        continue;
      }

      // Number
      if (/[0-9]/.test(code[i])) {
        let j = i;
        if (code[j] === '0' && (code[j + 1] === 'x' || code[j + 1] === 'X')) {
          j += 2;
          while (j < len && /[0-9a-fA-F]/.test(code[j])) j++;
        } else {
          while (j < len && /[0-9.eE+\-]/.test(code[j])) j++;
        }
        tokens.push({ type: 'number', value: code.slice(i, j) });
        i = j;
        continue;
      }

      // Punctuation
      if (/[{}()\[\];,]/.test(code[i])) {
        tokens.push({ type: 'punct', value: code[i] });
        i++;
        continue;
      }

      // Operator
      if (/[+\-*/%=<>!&|^~?:]/.test(code[i])) {
        let j = i;
        while (j < len && /[+\-*/%=<>!&|^~?:]/.test(code[j])) j++;
        tokens.push({ type: 'op', value: code.slice(i, j) });
        i = j;
        continue;
      }

      // Identifier
      if (/[a-zA-Z_$]/.test(code[i])) {
        let j = i;
        while (j < len && /[\w$]/.test(code[j])) j++;
        tokens.push({ type: 'ident', value: code.slice(i, j) });
        i = j;
        continue;
      }

      // Dot
      if (code[i] === '.') {
        tokens.push({ type: 'punct', value: '.' });
        i++;
        continue;
      }

      // Unknown
      tokens.push({ type: 'other', value: code[i] });
      i++;
    }

    // Reconstruct with indentation
    let depth = 0;
    let result = '';
    let needIndent = true;

    for (let t = 0; t < tokens.length; t++) {
      const tok = tokens[t];

      // Skip whitespace tokens, we'll add our own
      if (tok.type === 'ws') {
        // Only preserve newlines in comments
        continue;
      }

      // Add indentation at line start
      if (needIndent) {
        result += '  '.repeat(depth);
        needIndent = false;
      }

      // Comments: preserve as-is, they end the line
      if (tok.type === 'comment') {
        result += tok.value;
        if (tok.value.startsWith('//')) {
          result += '\n';
          needIndent = true;
        } else {
          // Block comment - check if it contains newlines
          if (tok.value.includes('\n')) {
            result += '\n';
            needIndent = true;
          }
        }
        continue;
      }

      // Opening braces increase depth after
      if (tok.type === 'punct' && tok.value === '{') {
        result += '{\n';
        depth++;
        needIndent = true;
        continue;
      }

      // Closing braces decrease depth before
      if (tok.type === 'punct' && tok.value === '}') {
        depth = Math.max(0, depth - 1);
        result = result.trimEnd() + '\n' + '  '.repeat(depth) + '}';
        // Check if next non-ws token suggests this is end of block
        const next = tokens[t + 1];
        if (next && next.type === 'punct' && next.value === ',') {
          result += ',';
          t++;
        }
        result += '\n';
        needIndent = true;
        continue;
      }

      // Semicolons end the line
      if (tok.type === 'punct' && tok.value === ';') {
        result += ';\n';
        needIndent = true;
        continue;
      }

      // Space before/after operators and some punctuation
      if (tok.type === 'op') {
        result += ' ' + tok.value + ' ';
        continue;
      }

      if (tok.type === 'punct' && tok.value === ',') {
        result += ', ';
        continue;
      }

      if (tok.type === 'punct' && (tok.value === '(' || tok.value === '[')) {
        result += tok.value;
        continue;
      }

      if (tok.type === 'punct' && (tok.value === ')' || tok.value === ']')) {
        result += tok.value;
        continue;
      }

      if (tok.type === 'punct' && tok.value === ':') {
        result += ': ';
        continue;
      }

      // Keywords
      if (tok.type === 'ident' && KEYWORDS.has(tok.value)) {
        result += tok.value + ' ';
        // Remove trailing space before certain punctuation
        continue;
      }

      // Everything else
      result += tok.value;
    }

    return result.trim();
  }

  // Create the code editor
  function createCodeEditor(options = {}) {
    const placeholder = options.placeholder || '';
    const maxHeight = options.maxHeight || 200;

    // Container
    const container = document.createElement('div');
    container.className = 'ce-container';

    // Editor wrapper
    const editorWrap = document.createElement('div');
    editorWrap.className = 'ce-editor-wrap';
    editorWrap.style.maxHeight = maxHeight + 'px';

    // Line numbers
    const lineNumbers = document.createElement('div');
    lineNumbers.className = 'ce-line-numbers';

    // Highlight layer (pre)
    const highlightLayer = document.createElement('pre');
    highlightLayer.className = 'ce-highlight';
    highlightLayer.setAttribute('aria-hidden', 'true');

    // Textarea
    const textarea = document.createElement('textarea');
    textarea.className = 'ce-textarea';
    textarea.placeholder = placeholder;
    textarea.spellcheck = false;
    textarea.autocapitalize = 'off';
    textarea.autocomplete = 'off';

    // Tab handling
    textarea.addEventListener('keydown', function (e) {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = this.selectionStart;
        const end = this.selectionEnd;
        this.value = this.value.substring(0, start) + '  ' + this.value.substring(end);
        this.selectionStart = this.selectionEnd = start + 2;
        updateHighlight();
      }
    });

    // Scroll sync
    textarea.addEventListener('scroll', function () {
      highlightLayer.scrollTop = this.scrollTop;
      highlightLayer.scrollLeft = this.scrollLeft;
      lineNumbers.scrollTop = this.scrollTop;
    });

    // Input sync
    textarea.addEventListener('input', updateHighlight);

    editorWrap.appendChild(lineNumbers);
    editorWrap.appendChild(highlightLayer);
    editorWrap.appendChild(textarea);
    container.appendChild(editorWrap);

    // Format button
    const toolbar = document.createElement('div');
    toolbar.className = 'ce-toolbar';
    const formatBtn = document.createElement('button');
    formatBtn.type = 'button';
    formatBtn.className = 'ce-format-btn';
    formatBtn.textContent = options.formatLabel || 'Format';
    formatBtn.addEventListener('click', function () {
      const formatted = formatJS(textarea.value);
      textarea.value = formatted;
      updateHighlight();
    });
    toolbar.appendChild(formatBtn);
    container.appendChild(toolbar);

    function updateHighlight() {
      const code = textarea.value;
      // Update syntax highlighting
      highlightLayer.innerHTML = highlight(code) + '\n'; // Extra newline for scroll sync
      // Update line numbers
      const lineCount = code.split('\n').length;
      let linesHtml = '';
      for (let i = 1; i <= lineCount; i++) {
        linesHtml += i + '\n';
      }
      lineNumbers.textContent = linesHtml;
    }

    // Initialize
    updateHighlight();

    return {
      container: container,
      getValue: function () {
        return textarea.value;
      },
      setValue: function (str) {
        textarea.value = str || '';
        updateHighlight();
      }
    };
  }

  // Create a collapsible section containing the code editor
  function createCodeEditorSection(options = {}) {
    const section = document.createElement('div');
    section.className = 'ce-section';

    // Header
    const header = document.createElement('div');
    header.className = 'ce-section-header';

    const arrow = document.createElement('span');
    arrow.className = 'ce-arrow';
    arrow.textContent = '\u25B6'; // ▶

    const label = document.createElement('span');
    label.className = 'ce-section-label';
    label.textContent = options.label || 'User Script';

    const hint = document.createElement('span');
    hint.className = 'ce-section-hint';
    hint.textContent = options.hint || '';

    header.appendChild(arrow);
    header.appendChild(label);
    if (options.hint) header.appendChild(hint);
    section.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.className = 'ce-section-body ce-collapsed';

    const editor = createCodeEditor({
      placeholder: options.placeholder || '',
      maxHeight: options.maxHeight || 200,
      formatLabel: options.formatLabel || 'Format'
    });
    body.appendChild(editor.container);
    section.appendChild(body);

    // Toggle
    header.addEventListener('click', function () {
      const isCollapsed = body.classList.contains('ce-collapsed');
      if (isCollapsed) {
        body.classList.remove('ce-collapsed');
        arrow.textContent = '\u25BC'; // ▼
      } else {
        body.classList.add('ce-collapsed');
        arrow.textContent = '\u25B6'; // ▶
      }
    });

    return {
      container: section,
      getValue: editor.getValue,
      setValue: function (str) {
        editor.setValue(str);
        // Auto-expand if there's content
        if (str) {
          const body = section.querySelector('.ce-section-body');
          const arrow = section.querySelector('.ce-arrow');
          body.classList.remove('ce-collapsed');
          arrow.textContent = '\u25BC';
        }
      }
    };
  }

  // Inject styles (only once)
  function injectStyles() {
    if (document.getElementById('ce-styles')) return;

    const style = document.createElement('style');
    style.id = 'ce-styles';
    style.textContent = `
.ce-container {
  width: 100%;
}
.ce-editor-wrap {
  position: relative;
  display: flex;
  overflow: hidden;
  background: #1e1e1e;
  border-radius: 4px;
  border: 1px solid #3c3c3c;
}
.ce-line-numbers {
  width: 36px;
  padding: 8px 4px 8px 8px;
  background: #252526;
  color: #858585;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre;
  overflow: hidden;
  text-align: right;
  user-select: none;
  flex-shrink: 0;
}
.ce-highlight {
  position: absolute;
  top: 0;
  left: 36px;
  right: 0;
  bottom: 0;
  padding: 8px;
  margin: 0;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-wrap: break-word;
  overflow: auto;
  color: #abb2bf;
  pointer-events: none;
  background: transparent;
  z-index: 1;
}
.ce-textarea {
  position: absolute;
  top: 0;
  left: 36px;
  right: 0;
  bottom: 0;
  padding: 8px;
  margin: 0;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-wrap: break-word;
  overflow: auto;
  color: transparent;
  caret-color: #d4d4d4;
  background: transparent;
  border: none;
  outline: none;
  resize: none;
  z-index: 2;
  -webkit-text-fill-color: transparent;
  tab-size: 2;
}
.ce-textarea::placeholder {
  color: #5c6370;
  -webkit-text-fill-color: #5c6370;
}
.ce-textarea:focus {
  outline: none;
}
.ce-editor-wrap:focus-within {
  border-color: #007acc;
}
.ce-keyword { color: #c678dd; }
.ce-string { color: #98c379; }
.ce-comment { color: #5c6370; font-style: italic; }
.ce-number { color: #d19a66; }
.ce-boolean { color: #56b6c2; }
.ce-toolbar {
  display: flex;
  justify-content: flex-end;
  padding: 4px 0 0 0;
}
.ce-format-btn {
  padding: 2px 8px;
  font-size: 11px;
  color: #999;
  background: #2d2d2d;
  border: 1px solid #3c3c3c;
  border-radius: 3px;
  cursor: pointer;
}
.ce-format-btn:hover {
  color: #ccc;
  background: #3c3c3c;
}
.ce-section {
  margin-top: 8px;
}
.ce-section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 0;
  cursor: pointer;
  user-select: none;
  font-size: 11px;
  color: #666;
}
.ce-section-header:hover {
  color: #333;
}
.ce-arrow {
  font-size: 9px;
  transition: transform 0.15s;
  flex-shrink: 0;
}
.ce-section-label {
  font-weight: 500;
}
.ce-section-hint {
  color: #999;
  font-size: 10px;
  margin-left: auto;
}
.ce-section-body {
  overflow: hidden;
  transition: max-height 0.2s ease, opacity 0.2s ease, padding 0.2s ease;
  max-height: 300px;
  opacity: 1;
  padding-top: 4px;
}
.ce-section-body.ce-collapsed {
  max-height: 0;
  opacity: 0;
  padding-top: 0;
}
`;
    document.head.appendChild(style);
  }

  // Expose globally
  window.__element_monitor_createCodeEditor = function (options) {
    injectStyles();
    return createCodeEditor(options);
  };
  window.__element_monitor_createCodeEditorSection = function (options) {
    injectStyles();
    return createCodeEditorSection(options);
  };

})();
