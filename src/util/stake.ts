import Ticker from '../@types/Ticker.js'
import stakingPairs from './stakingPairs.js'

/**
 * {
 *   ETH: ['ETHX', 'WETH', 'STETH'],
 *   AVAX: ['SAVAX'],
 *   ...
 * }
 */
const unstakedToStakedMap = stakingPairs.reduce(
  (accum, stakingPair) => ({
    ...accum,
    [stakingPair.unstaked]: stakingPair.staked,
  }),
  {} as { [key: string]: Ticker[] },
)

/** Get the staked tickers that correspond with the given unstaked ticker, e.g. ETH -> [ETHX, WETH, STETH]. */
const stake = (ticker: Ticker): Ticker[] | undefined => unstakedToStakedMap[ticker]

export default stake
