interface Transaction {
  buy?: number
  buyCur?: string
  cost: number
  date: Date
  dateAcquired: Date
  deferredGains?: number
  sell?: number
  sellCur?: string
}

export default Transaction
