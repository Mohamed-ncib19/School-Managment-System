import Decimal from "decimal.js";
import { Money, money } from "./money.util";

/**
 * A deliberately tiny arithmetic evaluator for the `custom` compensation model.
 *
 * Custom formulas are written by an administrator and stored in the database,
 * which makes them untrusted input by the time they reach the server. `eval` or
 * `new Function` would hand that administrator — or anyone who reached the
 * settings endpoint — the whole Node process, so this parses the expression
 * itself and supports nothing beyond numbers, the four operators, parentheses
 * and a fixed set of named variables. There is no property access, no call
 * syntax and no way to reference anything outside `vars`.
 *
 * Arithmetic runs in Decimal throughout, so a custom formula rounds exactly the
 * way the built-in models do.
 */

/** Everything a formula is allowed to name. Anything else is a parse error. */
export const FORMULA_VARIABLES = [
  "amount",
  "percentage",
  "fixed",
  "students",
  "groups",
] as const;

export type FormulaVariable = (typeof FORMULA_VARIABLES)[number];

export type FormulaScope = Record<FormulaVariable, Money>;

type Token =
  | { kind: "number"; value: Money }
  | { kind: "variable"; name: FormulaVariable }
  | { kind: "operator"; value: "+" | "-" | "*" | "/" }
  | { kind: "paren"; value: "(" | ")" };

export class FormulaError extends Error {}

const PRECEDENCE: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2 };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const char = input[i];

    if (/\s/.test(char)) {
      i++;
      continue;
    }

    if (char === "(" || char === ")") {
      tokens.push({ kind: "paren", value: char });
      i++;
      continue;
    }

    if (char === "+" || char === "-" || char === "*" || char === "/") {
      tokens.push({ kind: "operator", value: char });
      i++;
      continue;
    }

    if (/[0-9.]/.test(char)) {
      let literal = "";
      while (i < input.length && /[0-9.]/.test(input[i])) literal += input[i++];
      if ((literal.match(/\./g) ?? []).length > 1) {
        throw new FormulaError(`Malformed number "${literal}"`);
      }
      tokens.push({ kind: "number", value: new Decimal(literal) });
      continue;
    }

    if (/[a-zA-Z_]/.test(char)) {
      let name = "";
      while (i < input.length && /[a-zA-Z_0-9]/.test(input[i])) name += input[i++];
      if (!FORMULA_VARIABLES.includes(name as FormulaVariable)) {
        throw new FormulaError(
          `Unknown variable "${name}". Available: ${FORMULA_VARIABLES.join(", ")}`,
        );
      }
      tokens.push({ kind: "variable", name: name as FormulaVariable });
      continue;
    }

    throw new FormulaError(`Unexpected character "${char}"`);
  }

  return tokens;
}

/**
 * Shunting-yard into RPN, then evaluate. Unary minus is handled by rewriting
 * `-x` as `0 - x` when a minus appears where a value was expected, which is the
 * only place an expression this small can be ambiguous.
 */
function toRpn(tokens: Token[]): Token[] {
  const output: Token[] = [];
  const operators: Token[] = [];
  let expectValue = true;

  for (const token of tokens) {
    if (token.kind === "number" || token.kind === "variable") {
      output.push(token);
      expectValue = false;
      continue;
    }

    if (token.kind === "operator") {
      if (expectValue) {
        if (token.value !== "-" && token.value !== "+") {
          throw new FormulaError(`Operator "${token.value}" has no left-hand operand`);
        }
        // Unary: push an implicit zero and carry on as a binary operation.
        output.push({ kind: "number", value: new Decimal(0) });
      }

      while (operators.length > 0) {
        const top = operators[operators.length - 1];
        if (top.kind !== "operator") break;
        if (PRECEDENCE[top.value] < PRECEDENCE[token.value]) break;
        output.push(operators.pop()!);
      }
      operators.push(token);
      expectValue = true;
      continue;
    }

    if (token.value === "(") {
      operators.push(token);
      expectValue = true;
      continue;
    }

    // ")"
    let matched = false;
    while (operators.length > 0) {
      const top = operators.pop()!;
      if (top.kind === "paren" && top.value === "(") {
        matched = true;
        break;
      }
      output.push(top);
    }
    if (!matched) throw new FormulaError("Unbalanced parentheses");
    expectValue = false;
  }

  while (operators.length > 0) {
    const top = operators.pop()!;
    if (top.kind === "paren") throw new FormulaError("Unbalanced parentheses");
    output.push(top);
  }

  if (expectValue) throw new FormulaError("Expression ends with an operator");
  return output;
}

function evaluateRpn(rpn: Token[], scope: FormulaScope): Money {
  const stack: Money[] = [];

  for (const token of rpn) {
    if (token.kind === "number") {
      stack.push(token.value);
      continue;
    }
    if (token.kind === "variable") {
      stack.push(money(scope[token.name]));
      continue;
    }
    if (token.kind !== "operator") throw new FormulaError("Malformed expression");

    const right = stack.pop();
    const left = stack.pop();
    if (left === undefined || right === undefined) {
      throw new FormulaError("Malformed expression");
    }

    switch (token.value) {
      case "+":
        stack.push(left.plus(right));
        break;
      case "-":
        stack.push(left.minus(right));
        break;
      case "*":
        stack.push(left.times(right));
        break;
      case "/":
        // A formula dividing by a variable that happens to be zero this month
        // must not take the request down with it.
        if (right.isZero()) throw new FormulaError("Division by zero");
        stack.push(left.dividedBy(right));
        break;
    }
  }

  if (stack.length !== 1) throw new FormulaError("Malformed expression");
  return stack[0];
}

/** Parses and evaluates in one step. Throws `FormulaError` on any bad input. */
export function evaluateFormula(expression: string, scope: FormulaScope): Money {
  if (!expression || !expression.trim()) throw new FormulaError("Formula is empty");
  if (expression.length > 500) throw new FormulaError("Formula is too long");
  return evaluateRpn(toRpn(tokenize(expression)), scope);
}

/**
 * Parse-checks a formula without needing real values, so the settings screen can
 * reject a typo at save time rather than at the till.
 */
export function validateFormula(expression: string): { valid: boolean; error?: string } {
  const probe: FormulaScope = {
    amount: new Decimal(100),
    percentage: new Decimal(60),
    fixed: new Decimal(50),
    students: new Decimal(10),
    groups: new Decimal(2),
  };

  try {
    evaluateFormula(expression, probe);
    return { valid: true };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : String(err) };
  }
}
