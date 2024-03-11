interface CoinTrackingTrade {
  Type: 'Trade' | 'Deposit' | 'Withdrawal' | 'Spend' | 'Lost' | 'Income'
  Buy: number | null
  CurBuy?: string
  Sell: number | null
  CurSell?: string
  Exchange: string
  Fee?: string
  'Trade Group'?:
    | 'Bitfinex Margin'
    | 'Borrowed'
    | 'Exchange'
    | 'Kraken Ledger'
    | 'Kraken Margin'
    | 'Kraken Rollover'
    | 'Lending'
    | 'Margin'
  Comment?: string
  // dd.mm.yyyy hh:mm
  'Trade Date': string
  Price?: number
}

export default CoinTrackingTrade
