import Ticker from '../@types/Ticker.js'

interface StakingPair {
  unstaked: Ticker
  staked: Ticker[]
}

const stakingPairs: StakingPair[] = [
  {
    unstaked: 'AVAX',
    staked: ['SAVAX'],
  },
  {
    unstaked: 'ETH',
    staked: ['ETHX', 'WETH'],
  },
]

export default stakingPairs
