import Ticker from '../@types/Ticker.js'
import stakingPairs from './stakingPairs.js'

/**
 * {
 *   ETHX: 'ETH',
 *   WETH: 'ETH',
 *   SAVAX: 'AVAX',
 *   ...
 * }
 */
const stakedToUnstakedMap = stakingPairs.reduce(
  (accum, stakingPair) => ({
    ...accum,
    ...stakingPair.staked.reduce((accum, ticker) => ({ ...accum, [ticker]: stakingPair.unstaked }), {}),
  }),
  {} as { [key: string]: Ticker },
)

/** Get the unstaked ticker that corresponds with the given staked ticker, e.g. SAVAX -> AVAX. */
const unstake = (ticker: Ticker): Ticker | undefined => stakedToUnstakedMap[ticker]

export default unstake
