import Ticker from './Ticker.js'

interface Trade {
  /** Trade type.
   * Rebate - Credit card rewards are rebates and are not considered taxable income. If received in crypto, track the date and basis of the rewards so when you sell the coins, you can determine your overall gain/loss.
   */
  type: 'Trade' | 'Deposit' | 'Withdrawal' | 'Spend' | 'Lost' | 'Income' | 'Rebate'
  /** The amount received either through a Trade, Deposit, or Withdrawal (unsigned). */
  buy: number | null
  /** The ticker symbol of the Buy currency. */
  curBuy?: Ticker
  /** The amount debited through a Sell. */
  sell: number | null
  /** The ticker symbol of the Sell currency. */
  curSell?: Ticker
  exchange: string
  fee?: string
  tradeGroup?:
    | 'Bitfinex Margin'
    | 'Borrowed'
    | 'Exchange'
    | 'Kraken Ledger'
    | 'Kraken Margin'
    | 'Kraken Rollover'
    | 'Lending'
    | 'Margin'
  comment?: string
  price?: number
  date: Date
}

export default Trade
