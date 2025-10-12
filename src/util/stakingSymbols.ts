import Ticker from '../@types/Ticker.js'
import stakingPairs from './stakingPairs.js'

/** Set of all stakiing symbols: ETHX, WETH, AVAX, ... */
const stakingSymbols: Set<Ticker> = new Set(stakingPairs.flatMap(pair => pair.staked))

export default stakingSymbols
