interface Transaction {
  buy: number
  buyCur: string
  cost: number
  date: string
  dateAcquired: string
  deferredGains?: number
  sell?: string
  sellCur?: string
}

export default Transaction
