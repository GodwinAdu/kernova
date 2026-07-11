/**
 * Built-in Tool: math-eval
 *
 * Safely evaluates mathematical expressions without using eval() or Function().
 * Implements a recursive-descent parser supporting:
 * - Arithmetic: +, -, *, /, %, ^ (power)
 * - Functions: sqrt, abs, ceil, floor, round, sin, cos, tan, log, log2, log10, min, max
 * - Constants: pi, e, random
 * - Parentheses for grouping
 */

import type { ToolDefinition } from '../plugins/plugin-registry.js';

// Token types for the lexer
type TokenType =
  | 'number'
  | 'operator'
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'identifier'
  | 'eof';

interface Token {
  type: TokenType;
  value: string;
}

class MathLexer {
  private pos = 0;
  private input: string;

  constructor(input: string) {
    this.input = input.replace(/\s+/g, '');
  }

  peek(): Token {
    const saved = this.pos;
    const token = this.next();
    this.pos = saved;
    return token;
  }

  next(): Token {
    if (this.pos >= this.input.length) {
      return { type: 'eof', value: '' };
    }

    const ch = this.input[this.pos];

    // Numbers (including decimals)
    if (ch >= '0' && ch <= '9' || ch === '.') {
      let num = '';
      while (
        this.pos < this.input.length &&
        ((this.input[this.pos] >= '0' && this.input[this.pos] <= '9') ||
          this.input[this.pos] === '.')
      ) {
        num += this.input[this.pos++];
      }
      return { type: 'number', value: num };
    }

    // Identifiers (function names and constants)
    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) {
      let id = '';
      while (
        this.pos < this.input.length &&
        ((this.input[this.pos] >= 'a' && this.input[this.pos] <= 'z') ||
          (this.input[this.pos] >= 'A' && this.input[this.pos] <= 'Z') ||
          (this.input[this.pos] >= '0' && this.input[this.pos] <= '9'))
      ) {
        id += this.input[this.pos++];
      }
      return { type: 'identifier', value: id };
    }

    // Operators
    if ('+-*/%^'.includes(ch)) {
      this.pos++;
      return { type: 'operator', value: ch };
    }

    if (ch === '(') {
      this.pos++;
      return { type: 'lparen', value: '(' };
    }
    if (ch === ')') {
      this.pos++;
      return { type: 'rparen', value: ')' };
    }
    if (ch === ',') {
      this.pos++;
      return { type: 'comma', value: ',' };
    }

    throw new Error(`Unexpected character: '${ch}' at position ${this.pos}`);
  }
}

class MathParser {
  private lexer: MathLexer;
  private current: Token;

  private readonly constants: Record<string, number> = {
    pi: Math.PI,
    e: Math.E,
    random: Math.random(),
  };

  private readonly functions: Record<string, (...args: number[]) => number> = {
    sqrt: Math.sqrt,
    abs: Math.abs,
    ceil: Math.ceil,
    floor: Math.floor,
    round: Math.round,
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    log: Math.log,
    log2: Math.log2,
    log10: Math.log10,
    min: (...args: number[]) => Math.min(...args),
    max: (...args: number[]) => Math.max(...args),
  };

  constructor(expression: string) {
    this.lexer = new MathLexer(expression);
    this.current = this.lexer.next();
  }

  parse(): number {
    const result = this.parseExpression();
    if (this.current.type !== 'eof') {
      throw new Error(`Unexpected token: '${this.current.value}'`);
    }
    return result;
  }

  // Expression: handles + and - (lowest precedence)
  private parseExpression(): number {
    let left = this.parseTerm();

    while (
      this.current.type === 'operator' &&
      (this.current.value === '+' || this.current.value === '-')
    ) {
      const op = this.current.value;
      this.current = this.lexer.next();
      const right = this.parseTerm();
      left = op === '+' ? left + right : left - right;
    }

    return left;
  }

  // Term: handles * / % (medium precedence)
  private parseTerm(): number {
    let left = this.parsePower();

    while (
      this.current.type === 'operator' &&
      (this.current.value === '*' || this.current.value === '/' || this.current.value === '%')
    ) {
      const op = this.current.value;
      this.current = this.lexer.next();
      const right = this.parsePower();
      if (op === '*') left = left * right;
      else if (op === '/') left = left / right;
      else left = left % right;
    }

    return left;
  }

  // Power: handles ^ (right-associative, higher precedence)
  private parsePower(): number {
    const base = this.parseUnary();

    if (this.current.type === 'operator' && this.current.value === '^') {
      this.current = this.lexer.next();
      const exp = this.parsePower(); // Right-associative
      return Math.pow(base, exp);
    }

    return base;
  }

  // Unary: handles - prefix (e.g., -5)
  private parseUnary(): number {
    if (this.current.type === 'operator' && this.current.value === '-') {
      this.current = this.lexer.next();
      return -this.parseUnary();
    }
    if (this.current.type === 'operator' && this.current.value === '+') {
      this.current = this.lexer.next();
      return this.parseUnary();
    }
    return this.parsePrimary();
  }

  // Primary: numbers, parentheses, functions, constants
  private parsePrimary(): number {
    // Number literal
    if (this.current.type === 'number') {
      const value = parseFloat(this.current.value);
      if (isNaN(value)) {
        throw new Error(`Invalid number: '${this.current.value}'`);
      }
      this.current = this.lexer.next();
      return value;
    }

    // Parenthesized expression
    if (this.current.type === 'lparen') {
      this.current = this.lexer.next();
      const value = this.parseExpression();
      if (this.current.type !== 'rparen') {
        throw new Error('Missing closing parenthesis');
      }
      this.current = this.lexer.next();
      return value;
    }

    // Identifier (function or constant)
    if (this.current.type === 'identifier') {
      const name = this.current.value.toLowerCase();
      this.current = this.lexer.next();

      // Check if it's a function call
      if (this.current.type === 'lparen') {
        const fn = this.functions[name];
        if (!fn) {
          throw new Error(`Unknown function: '${name}'`);
        }
        this.current = this.lexer.next();

        const args: number[] = [];
        if (this.current.type !== 'rparen') {
          args.push(this.parseExpression());
          while (this.current.type === 'comma') {
            this.current = this.lexer.next();
            args.push(this.parseExpression());
          }
        }

        if (this.current.type !== 'rparen') {
          throw new Error(`Missing closing parenthesis for function '${name}'`);
        }
        this.current = this.lexer.next();

        return fn(...args);
      }

      // It's a constant
      if (name in this.constants) {
        return this.constants[name];
      }

      throw new Error(`Unknown identifier: '${name}'`);
    }

    throw new Error(
      `Unexpected token: '${this.current.value}' (type: ${this.current.type})`,
    );
  }
}

export function createMathEvalTool(): ToolDefinition {
  return {
    id: 'math-eval',
    name: 'Math Eval',
    description:
      'Safely evaluate mathematical expressions. Supports +, -, *, /, %, ^ (power), sqrt, abs, ceil, floor, round, sin, cos, tan, log, log2, log10, min, max, pi, e, random.',
    parameters: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'Math expression to evaluate (e.g., "2 * pi + sqrt(16)")',
        },
      },
      required: ['expression'],
    },
    execute: async (params: Record<string, unknown>): Promise<unknown> => {
      const expression = params.expression as string;

      if (!expression || expression.trim().length === 0) {
        return {
          error: true,
          message: 'Expression cannot be empty',
        };
      }

      try {
        const parser = new MathParser(expression);
        const result = parser.parse();

        if (!isFinite(result) && !isNaN(result)) {
          return { expression, result: result > 0 ? Infinity : -Infinity };
        }

        return { expression, result };
      } catch (err) {
        return {
          error: true,
          message: `Invalid expression: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}
