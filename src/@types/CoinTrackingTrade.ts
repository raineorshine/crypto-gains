import Ticker from './Ticker.js'

interface CoinTrackingTrade {
  /** Trade type.
   * Rebate - Credit card rewards are rebates and are not considered taxable income. If received in crypto, track the date and basis of the rewards so when you sell the coins, you can determine your overall gain/loss.
   */
  Type: 'Trade' | 'Deposit' | 'Withdrawal' | 'Spend' | 'Lost' | 'Income' | 'Rebate'
  /** The amount received either through a Trade, Deposit, or Withdrawal (unsigned). */
  Buy: number | null
  /** The ticker symbol of the Buy currency. */
  CurBuy?: Ticker
  /** The amount debited through a Sell. */
  Sell: number | null
  /** The ticker symbol of the Sell currency. */
  CurSell?: Ticker
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
