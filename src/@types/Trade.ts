import DateString from './DateString.js'
import Ticker from './Ticker.js'

interface Trade {
  sell: number
  sellCur?: Ticker
  buy: number
  buyCur?: Ticker
  date: DateString
  price?: number
  isLikekind?: boolean
  type?: 'fifo' | 'lifo'
}

export default Trade
