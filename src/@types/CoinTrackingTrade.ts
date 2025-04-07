interface CoinTrackingTrade {
  Type: 'Trade' | 'Deposit' | 'Withdrawal' | 'Spend' | 'Lost' | 'Income'
  /** The amount received either through a Trade, Deposit, or Withdrawal (unsigned). */
  Buy: number | null
  /** The ticker symbol of the Buy currency. */
  CurBuy?: string
  /** The amount debited through a Sell. */
  Sell: number | null
  /** The ticker symbol of the Sell currency. */
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
