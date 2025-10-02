const stableCoins = new Set(['USDC', 'USDT', 'DAI', 'BUSD'])

/** Returns true if the currency is a stable coin such as USDC, USDT, BUSD, or DAI.. */
const isStableCoin = (cur: string | undefined) => cur && stableCoins.has(cur)

export default isStableCoin
