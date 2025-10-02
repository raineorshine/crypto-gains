const stableCoins = new Set(['USDT', 'USDC', 'DAI', 'BUSD'])

const isStableCoin = (cur: string | undefined) => cur && stableCoins.has(cur)

export default isStableCoin
