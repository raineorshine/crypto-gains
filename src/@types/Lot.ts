import Ticker from './Ticker.js'

interface Lot {
  cur: Ticker
  amount: number
  cost: number
  date: Date
  deferredGains?: number
}

export default Lot
