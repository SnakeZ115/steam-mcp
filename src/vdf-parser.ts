export type VdfValue = string | VdfObject;

export interface VdfObject {
  [key: string]: VdfValue;
}

export class VdfParseError extends Error {
  readonly line: number;
  readonly column: number;

  constructor(message: string, line: number, column: number) {
    super(`${message} (line ${line}, column ${column})`);
    this.name = 'VdfParseError';
    this.line = line;
    this.column = column;
  }
}

type VdfToken =
  | { type: 'string'; value: string; line: number; column: number }
  | { type: 'open_brace'; line: number; column: number }
  | { type: 'close_brace'; line: number; column: number };

const ESCAPE_MAP: Record<string, string> = {
  '\\': '\\',
  '"': '"',
  n: '\n',
  t: '\t',
  r: '\r',
};

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function setSafeProperty(target: VdfObject, key: string, value: VdfValue): void {
  if (FORBIDDEN_KEYS.has(key)) {
    Object.defineProperty(target, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    return;
  }
  target[key] = value;
}

function isPlainRecord(value: unknown): value is VdfObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\v' || ch === '\f';
}

function tokenizeVdf(rawContent: string): VdfToken[] {
  const content = rawContent.startsWith('\uFEFF') ? rawContent.slice(1) : rawContent;
  const tokens: VdfToken[] = [];

  let index = 0;
  let line = 1;
  let column = 1;

  const advance = (): string => {
    const ch = content[index]!;
    index++;
    if (ch === '\n') {
      line++;
      column = 1;
    } else {
      column++;
    }
    return ch;
  };

  while (index < content.length) {
    const ch = content[index]!;

    if (isWhitespace(ch)) {
      advance();
      continue;
    }

    if (ch === '/' && content[index + 1] === '/') {
      while (index < content.length && content[index] !== '\n') {
        advance();
      }
      continue;
    }

    if (ch === '{') {
      tokens.push({ type: 'open_brace', line, column });
      advance();
      continue;
    }

    if (ch === '}') {
      tokens.push({ type: 'close_brace', line, column });
      advance();
      continue;
    }

    if (ch === '"') {
      const startLine = line;
      const startColumn = column;
      advance();

      let value = '';
      let closed = false;

      while (index < content.length) {
        const current = content[index]!;
        if (current === '"') {
          advance();
          closed = true;
          break;
        }
        if (current === '\\') {
          advance();
          if (index >= content.length) {
            throw new VdfParseError('Unterminated escape sequence in string literal', startLine, startColumn);
          }
          const next = advance();
          value += ESCAPE_MAP[next] ?? next;
          continue;
        }
        value += advance();
      }

      if (!closed) {
        throw new VdfParseError('Unterminated string literal', startLine, startColumn);
      }

      tokens.push({ type: 'string', value, line: startLine, column: startColumn });
      continue;
    }

    const startLine = line;
    const startColumn = column;
    let value = '';

    while (index < content.length) {
      const current = content[index]!;
      if (
        isWhitespace(current) ||
        current === '{' ||
        current === '}' ||
        current === '"' ||
        (current === '/' && content[index + 1] === '/')
      ) {
        break;
      }
      value += advance();
    }

    tokens.push({ type: 'string', value, line: startLine, column: startColumn });
  }

  return tokens;
}

/**
 * Parses Valve KeyValues (.vdf / .acf) text content into a nested plain object.
 */
export function parseVdf(content: string): VdfObject {
  if (typeof content !== 'string') {
    throw new TypeError('VDF content must be a string');
  }

  const tokens = tokenizeVdf(content);
  const root: VdfObject = {};
  const stack: Array<{
    obj: VdfObject;
    openLine: number;
    openColumn: number;
  }> = [{ obj: root, openLine: 1, openColumn: 1 }];

  let pos = 0;

  while (pos < tokens.length) {
    const frame = stack[stack.length - 1]!;
    const token = tokens[pos]!;

    if (token.type === 'close_brace') {
      if (stack.length === 1) {
        throw new VdfParseError("Unexpected '}' without matching '{'", token.line, token.column);
      }
      stack.pop();
      pos++;
      continue;
    }

    if (token.type === 'open_brace') {
      throw new VdfParseError("Unexpected '{' without preceding key", token.line, token.column);
    }

    const key = token.value;
    pos++;

    if (pos >= tokens.length) {
      throw new VdfParseError(`Unexpected end of input after key "${key}"`, token.line, token.column);
    }

    const next = tokens[pos]!;

    if (next.type === 'open_brace') {
      const existing = Object.prototype.hasOwnProperty.call(frame.obj, key) ? frame.obj[key] : undefined;
      let child: VdfObject;
      if (isPlainRecord(existing)) {
        child = existing;
      } else {
        child = {};
        setSafeProperty(frame.obj, key, child);
      }
      stack.push({ obj: child, openLine: next.line, openColumn: next.column });
      pos++;
      continue;
    }

    if (next.type === 'string') {
      setSafeProperty(frame.obj, key, next.value);
      pos++;
      continue;
    }

    throw new VdfParseError(`Expected value or '{' after key "${key}", got '}'`, next.line, next.column);
  }

  if (stack.length > 1) {
    const unclosed = stack[stack.length - 1]!;
    throw new VdfParseError("Unclosed '{' block", unclosed.openLine, unclosed.openColumn);
  }

  return root;
}
