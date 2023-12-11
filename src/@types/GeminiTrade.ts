interface GeminiTrade {
  // yyyy-mm-dd
  Date: string
  // hh:mm:ss.msm
  'Time (UTC)': string
  Type: 'Buy' | 'Sell' | 'Debit' | 'Credit'
  Symbol: string
  Specification: string
  'Liquidity Indicator': string
  'Trading Fee Rate (bps)': string
  'USD Amount USD': string
  'Fee (USD) USD': string
  'USD Balance USD': string
  'BTC Amount BTC': string
  'Fee (BTC) BTC': string
  'BTC Balance BTC': string
  'ETH Amount ETH': string
  'Fee (ETH) ETH': string
  'ETH Balance ETH': string
  'GUSD Amount GUSD': string
  'Fee (GUSD) GUSD': string
  'GUSD Balance GUSD': string
  'SOL Amount SOL': string
  'Fee (SOL) SOL': string
  'SOL Balance SOL': string
  'MATIC Amount MATIC': string
  'Fee (MATIC) MATIC': string
  'MATIC Balance MATIC': string
  'Trade ID': string
  'Order ID': string
  'Order Date': string
  'Order Time': string
  'Client Order ID': string
  'API Session': string
  'Tx Hash': string
  'Deposit Destination': string
  'Deposit Tx Output': string
  'Withdrawal Destination': string
  'Withdrawal Tx Output': string
}

export default GeminiTrade
