import Ticker from './Ticker.js'

interface LedgerTrade {
  'Operation Date': string
  Status: 'Confirmed' | 'Unconfirmed' | 'Failed'
  'Currency Ticker': Ticker
  'Operation Type': 'IN' | 'OUT' | 'FEES' | 'WITHDRAW_UNBONDED' | 'DELEGATE' | 'UNDELEGATE'
  'Operation Amount': number
  'Operation Fees': number
  'Operation Hash': string
  'Account Name': string
  'Account xpub': string
  'Countervalue Ticker': string
  'Countervalue at Operation Date': number
  'Countervalue at CSV Export': number
}

export default LedgerTrade
