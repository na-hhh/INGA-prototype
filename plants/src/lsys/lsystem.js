import { createRng } from '../sim/math.js';

// A parametric, stochastic L-system.
//
// Source format, one statement per line:
//   # comment
//   name = 30 [0, 90]            a constant (the optional range sizes its slider)
//   axiom: A(0)                  the starting string
//   A(n) : n < 5 -> F(1) A(n+1)  a rule; the condition is optional
//   [0.3] A(n) -> F(1)           a rule that applies with probability 0.3
//
// A module is one character, optionally followed by arguments: F(1.5).
// Arguments are expressions over the rule's parameters, the constants,
// Math functions (sin, pow, min, ...) and rnd(a, b).

const SYMBOL = /[A-Za-z+\-&^\\/|[\]!$'~%]/;
const MATH = 'const {sin,cos,tan,pow,min,max,abs,sqrt,floor,ceil,round,exp,log,PI}=Math;';
const MAX_MODULES = 700000;

function splitArgs(text) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out.map((s) => s.trim()).filter((s) => s.length);
}

function parseModules(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (!SYMBOL.test(ch)) throw new Error(`Unexpected character "${ch}"`);
    i++;
    let args = [];
    if (text[i] === '(') {
      let depth = 0;
      let j = i;
      for (; j < text.length; j++) {
        if (text[j] === '(') depth++;
        else if (text[j] === ')' && --depth === 0) break;
      }
      if (j >= text.length) throw new Error(`Missing ")" after ${ch}`);
      args = splitArgs(text.slice(i + 1, j));
      i = j + 1;
    }
    out.push({ s: ch, args });
  }
  return out;
}

// Compiles a list of modules into one function that returns their arguments.
function compileModules(modules, names) {
  const body = modules.map((m) => (m.args.length ? `[${m.args.join(',')}]` : 'null')).join(',');
  return { syms: modules.map((m) => m.s), fn: new Function(...names, 'rnd', `${MATH} return [${body}];`) };
}

export function parse(source) {
  const constants = [];
  const ruleLines = [];
  let axiomText = null;
  source.split('\n').forEach((raw, index) => {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) return;
    const where = `line ${index + 1}`;
    const constant = line.match(/^([A-Za-z_]\w*)\s*=\s*(-?[\d.]+)\s*(?:\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\])?$/);
    if (constant) {
      const value = Number(constant[2]);
      constants.push({
        name: constant[1],
        value,
        min: constant[3] !== undefined ? Number(constant[3]) : Math.min(0, value * 2),
        max: constant[4] !== undefined ? Number(constant[4]) : Math.max(1, value * 2),
      });
      return;
    }
    if (line.startsWith('axiom:')) {
      axiomText = line.slice(6);
      return;
    }
    const rule = line.match(/^(?:\[([\d.]+)\]\s*)?(\S)(?:\(([^)]*)\))?\s*(?::\s*(.+?))?\s*->\s*(.*)$/);
    if (!rule) throw new Error(`${where}: not a constant, an axiom or a rule`);
    ruleLines.push({ where, prob: rule[1] === undefined ? 1 : Number(rule[1]), sym: rule[2], params: rule[3] ? splitArgs(rule[3]) : [], cond: rule[4], body: rule[5] });
  });
  if (axiomText === null) throw new Error('No "axiom:" line');

  const constNames = constants.map((c) => c.name);
  const axiom = compileModules(parseModules(axiomText), constNames);
  const rules = new Map();
  for (const r of ruleLines) {
    try {
      const names = [...r.params, ...constNames];
      const compiled = {
        arity: r.params.length,
        prob: r.prob,
        cond: r.cond ? new Function(...names, 'rnd', `${MATH} return (${r.cond});`) : null,
        ...compileModules(parseModules(r.body), names),
      };
      if (!rules.has(r.sym)) rules.set(r.sym, []);
      rules.get(r.sym).push(compiled);
    } catch (e) {
      throw new Error(`${r.where}: ${e.message}`);
    }
  }
  return { constants, axiom, rules };
}

// Rewrites the axiom `steps` times. Returns every generation, so growth can
// be played back. Each module remembers the step it was created in.
export function derive(system, constValues, steps, seed) {
  const rng = createRng(seed);
  const rnd = (a = 1, b) => (b === undefined ? rng() * a : a + rng() * (b - a));
  const first = system.axiom.fn(...constValues, rnd);
  let gen = { s: system.axiom.syms.slice(), a: first, b: new Array(first.length).fill(0) };
  const generations = [gen];
  let truncated = false;
  const scratch = [];
  for (let step = 1; step <= steps; step++) {
    const s = [];
    const a = [];
    const b = [];
    for (let i = 0; i < gen.s.length; i++) {
      const sym = gen.s[i];
      const args = gen.a[i];
      const candidates = system.rules.get(sym);
      let chosen = null;
      if (candidates) {
        const arity = args ? args.length : 0;
        // Rules whose condition holds share the module by probability.
        let roll = rng();
        for (let k = 0; k < candidates.length; k++) {
          const rule = candidates[k];
          if (rule.arity !== arity) continue;
          scratch.length = 0;
          if (args) for (let q = 0; q < arity; q++) scratch.push(args[q]);
          for (let q = 0; q < constValues.length; q++) scratch.push(constValues[q]);
          if (rule.cond && !rule.cond(...scratch, rnd)) continue;
          if (roll < rule.prob) {
            chosen = rule;
            break;
          }
          roll -= rule.prob;
        }
      }
      if (!chosen) {
        s.push(sym);
        a.push(args);
        b.push(gen.b[i]);
        continue;
      }
      const out = chosen.fn(...scratch, rnd);
      for (let k = 0; k < out.length; k++) {
        s.push(chosen.syms[k]);
        a.push(out[k]);
        b.push(step);
      }
    }
    gen = { s, a, b };
    generations.push(gen);
    if (s.length > MAX_MODULES) {
      truncated = true;
      break;
    }
  }
  return { generations, truncated };
}
