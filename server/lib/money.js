// 金额精度统一口径：平台结算金额支持小数点后 10 位
// 说明：早期实现统一四舍五入到 2 位，改精度时只需改这里的 MONEY_DECIMALS。
export const MONEY_DECIMALS = 10

// 金额/数量：保留 10 位小数（去掉浮点尾差）
export const roundMoney = (n) => {
  const v = Number(n)
  return Number.isFinite(v) ? Number(v.toFixed(MONEY_DECIMALS)) : 0
}

// 比率/百分比：默认仍保留 2 位（增幅、占比这类展示口径不需要 10 位）
export const roundPercent = (n, digits = 2) => {
  const v = Number(n)
  return Number.isFinite(v) ? Number(v.toFixed(digits)) : 0
}
