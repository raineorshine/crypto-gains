interface LidoRewardTrade {
  date: string
  type: 'reward' | 'staking'
  direction: string
  change: number
  change_wei: string
  change_USD: number
  apr: number
  balance: number
  balance_wei: string
}

export default LidoRewardTrade
