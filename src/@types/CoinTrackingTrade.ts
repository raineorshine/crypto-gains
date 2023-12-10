interface CoinTrackingTrade {
  Type: 'Trade' | 'Deposit' | 'Withdrawal' | 'Spend' | 'Lost' | 'Income'
  Buy: number
  CurBuy?: string
  Sell: number
  CurSell?: string
  Exchange: string
  'Trade Group'?: string
  Comment?: string
  'Trade Date': string
  Price?: number
}

export default CoinTrackingTrade
