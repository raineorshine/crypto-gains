import Ticker from './Ticker.js'

interface SecureData {
  cryptoCompareApiKey: string
  icos: {
    Buy: string
    CurBuy: Ticker
    Sell: string
    CurSell: Ticker
    Date: string
  }[]
  /** See README. */
  fallbackPrice: { [key: string]: number }
}

export default SecureData
