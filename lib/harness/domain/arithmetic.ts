/**
 * Safe arithmetic evaluator for model-proposed calculations
 * (e.g. "120,000 + 85,000 - 45,000"). Recursive descent over + - * / and
 * parentheses only: no identifiers, no function calls, and no dynamic code
 * evaluation (which workerd forbids anyway).
 */
export class ArithmeticError extends Error {}

type Token = { kind: "number"; value: number } | { kind: "op"; value: string };

function tokenize(expression: string): Token[] {
  const source = expression
    .normalize("NFKC")
    .replace(/[−–]/g, "-")
    .replace(/[×xX]/g, "*")
    .replace(/÷/g, "/");
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if ("+-*/()".includes(char)) {
      tokens.push({ kind: "op", value: char });
      index += 1;
      continue;
    }
    const match = /^(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?/.exec(source.slice(index));
    if (match) {
      tokens.push({ kind: "number", value: Number(match[0].replace(/,/g, "")) });
      index += match[0].length;
      continue;
    }
    throw new ArithmeticError(`unexpected character "${char}" at ${index}`);
  }
  return tokens;
}

export function evaluateArithmetic(expression: string): number {
  if (expression.length > 2000) throw new ArithmeticError("expression too long");
  const tokens = tokenize(expression);
  if (tokens.length === 0) throw new ArithmeticError("empty expression");
  let position = 0;

  const peek = () => tokens[position];
  const takeOp = (ops: string) => {
    const token = peek();
    if (token?.kind === "op" && ops.includes(token.value)) {
      position += 1;
      return token.value;
    }
    return null;
  };

  function expressionRule(): number {
    let value = term();
    for (let op = takeOp("+-"); op; op = takeOp("+-")) {
      value = op === "+" ? value + term() : value - term();
    }
    return value;
  }

  function term(): number {
    let value = factor();
    for (let op = takeOp("*/"); op; op = takeOp("*/")) {
      const right = factor();
      if (op === "/" && right === 0) throw new ArithmeticError("division by zero");
      value = op === "*" ? value * right : value / right;
    }
    return value;
  }

  function factor(): number {
    const sign = takeOp("+-");
    if (sign) return sign === "-" ? -factor() : factor();
    const token = peek();
    if (!token) throw new ArithmeticError("unexpected end of expression");
    if (token.kind === "number") {
      position += 1;
      return token.value;
    }
    if (takeOp("(")) {
      const value = expressionRule();
      if (!takeOp(")")) throw new ArithmeticError("missing closing parenthesis");
      return value;
    }
    throw new ArithmeticError(`unexpected token "${token.value}"`);
  }

  const result = expressionRule();
  if (position !== tokens.length) throw new ArithmeticError("trailing tokens");
  if (!Number.isFinite(result)) throw new ArithmeticError("non-finite result");
  return result;
}
