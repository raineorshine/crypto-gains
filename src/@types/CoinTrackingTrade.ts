interface CoinTrackingTrade {
  Type: 'Trade' | 'Deposit' | 'Withdrawal' | 'Spend' | 'Lost' | 'Income'
  Buy: number | null
  CurBuy?: string
  Sell: number | null
  CurSell?: string
  Exchange: string
  'Trade Group'?: string
  Comment?: string
  'Trade Date': string
  Price?: number
}

export default CoinTrackingTrade
