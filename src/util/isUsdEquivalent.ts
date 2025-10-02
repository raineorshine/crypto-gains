import isStableCoin from './isStableCoin.js'

/** Returns true if the currency is USD or a stable coin. */
const isUsdEquivalent = (cur: string | undefined) => cur === 'USD' || isStableCoin(cur)

export default isUsdEquivalent
