// 结算公式引擎（安全求值，不使用 eval / new Function）
//
// 支持的语法：数字、变量、+ - * / % 、括号、一元负号。例如：
//   数量*单价            （默认）
//   数量*单价*系数
//   (数量*单价-扣款)*系数
//
// 变量取自白名单，避免表达式访问任意对象；求值结果必须是有限非负数。
import { ApiError } from './http.js'
import { roundMoney } from './money.js'

// 公式可用变量（键为表达式里书写的词，值为行/单据上的取数口径）
export const FORMULA_VARS = {
  数量: '本行验收数量',
  单价: '本行单价',
  金额: '导入表中原有的金额列',
  系数: '单据级结算系数（整单统一）'
}
export const DEFAULT_FORMULA = '数量*单价'
export const FORMULA_MAX_LENGTH = 120

const VAR_NAMES = Object.keys(FORMULA_VARS)

// ===== 词法 =====
function tokenize(input) {
  const tokens = []
  let i = 0
  while (i < input.length) {
    const ch = input[i]
    if (/\s/.test(ch)) { i++; continue }
    if (/[0-9.]/.test(ch)) {
      let num = ''
      while (i < input.length && /[0-9.]/.test(input[i])) { num += input[i++] }
      if ((num.match(/\./g) || []).length > 1) throw new ApiError(422, 'FORMULA_INVALID', `数字格式不正确：${num}`)
      tokens.push({ type: 'num', value: Number(num) })
      continue
    }
    // 变量名：中文/字母/下划线开头，后接中文/字母/数字/下划线
    if (/[\u4e00-\u9fa5A-Za-z_]/.test(ch)) {
      let name = ''
      while (i < input.length && /[\u4e00-\u9fa5A-Za-z0-9_]/.test(input[i])) { name += input[i++] }
      if (!VAR_NAMES.includes(name)) {
        throw new ApiError(422, 'FORMULA_INVALID', `公式中的变量「${name}」不可用，可用变量：${VAR_NAMES.join('、')}`)
      }
      tokens.push({ type: 'var', value: name })
      continue
    }
    if ('+-*/%()'.includes(ch)) { tokens.push({ type: ch }); i++; continue }
    throw new ApiError(422, 'FORMULA_INVALID', `公式包含不支持的字符：${ch}`)
  }
  return tokens
}

// ===== 语法（递归下降） =====
function parse(tokens) {
  let pos = 0
  const peek = () => tokens[pos]
  const eat = (type) => {
    const t = peek()
    if (!t || t.type !== type) throw new ApiError(422, 'FORMULA_INVALID', '公式括号不匹配或缺少运算数')
    pos++
    return t
  }

  function parsePrimary() {
    const t = peek()
    if (!t) throw new ApiError(422, 'FORMULA_INVALID', '公式不完整')
    if (t.type === 'num') { pos++; return { kind: 'num', value: t.value } }
    if (t.type === 'var') { pos++; return { kind: 'var', name: t.value } }
    if (t.type === '-') { pos++; return { kind: 'neg', node: parsePrimary() } }
    if (t.type === '(') {
      pos++
      const node = parseExpr()
      eat(')')
      return node
    }
    throw new ApiError(422, 'FORMULA_INVALID', `公式在「${t.value ?? t.type}」处不完整`)
  }

  function parseTerm() {
    let node = parsePrimary()
    while (peek() && ['*', '/', '%'].includes(peek().type)) {
      const op = tokens[pos++].type
      node = { kind: 'op', op, left: node, right: parsePrimary() }
    }
    return node
  }

  function parseExpr() {
    let node = parseTerm()
    while (peek() && ['+', '-'].includes(peek().type)) {
      const op = tokens[pos++].type
      node = { kind: 'op', op, left: node, right: parseTerm() }
    }
    return node
  }

  const ast = parseExpr()
  if (pos !== tokens.length) throw new ApiError(422, 'FORMULA_INVALID', '公式存在多余内容，请检查运算符')
  return ast
}

function evalNode(node, vars) {
  switch (node.kind) {
    case 'num': return node.value
    case 'var': return Number(vars[node.name] || 0)
    case 'neg': return -evalNode(node.node, vars)
    case 'op': {
      const a = evalNode(node.left, vars)
      const b = evalNode(node.right, vars)
      if (node.op === '+') return a + b
      if (node.op === '-') return a - b
      if (node.op === '*') return a * b
      if (node.op === '/') return b === 0 ? 0 : a / b
      if (node.op === '%') return b === 0 ? 0 : a % b
      throw new ApiError(422, 'FORMULA_INVALID', '不支持的运算符')
    }
    default: throw new ApiError(422, 'FORMULA_INVALID', '公式结构不正确')
  }
}


// 编译公式：语法错误在此抛出（保存前就能发现）
export function compileFormula(expr) {
  // 归一化：去掉空白，保证同一公式在库里有唯一写法（便于审计比对）
  const text = String(expr === undefined || expr === null || expr === '' ? DEFAULT_FORMULA : expr).replace(/\s+/g, '')
  if (text.length > FORMULA_MAX_LENGTH) {
    throw new ApiError(422, 'FORMULA_INVALID', `公式过长（最多 ${FORMULA_MAX_LENGTH} 字符）`)
  }
  const ast = parse(tokenize(text))
  return {
    formula: text,
    // 对一行数据求值；结果统一保留 10 位小数（见 lib/money.js）
    evaluate(row, billLevel = {}) {
      const vars = {
        数量: Number(row.quantity) || 0,
        单价: Number(row.unitPrice) || 0,
        金额: Number(row.amount) || 0,
        系数: billLevel.系数 !== undefined ? Number(billLevel.系数) || 0 : (row.系数 !== undefined ? Number(row.系数) || 0 : 1)
      }
      const value = evalNode(ast, vars)
      if (!Number.isFinite(value)) throw new ApiError(422, 'FORMULA_INVALID', '公式计算结果不是有效数字')
      if (value < 0) throw new ApiError(422, 'FORMULA_INVALID', '公式计算结果为负数，请检查公式')
      return roundMoney(value)
    }
  }
}

// 校验公式（仅语法/变量），返回规范化后的文本
export function validateFormula(expr) {
  return compileFormula(expr).formula
}
