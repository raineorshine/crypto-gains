import DateString from './DateString.js'
import Ticker from './Ticker.js'

interface Lot {
  cur: Ticker
  amount: number
  cost: number
  date: DateString
  deferredGains?: number
}

export default Lot
