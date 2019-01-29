const csvtojson = require('csvtojson')
const json2csv = require('json2csv')

// get the day of the tx
const day = tx => tx['Trade Date'].split(' ')[0]

// get the opposite tx type: Deposit/Withdrawal
const otherType = tx => tx.Type === 'Deposit' ? 'Withdrawal' : 'Deposit'

// convert a string value to a number and set '-' to 0
const z = v => v === '-' ? 0 : +v

// checks if two txs are within a margin of error from each other
let n = 0
const closeEnough = (tx1, tx2) => {
  // const errorRange =
  //   tx1.CurBuy === 'BTC' ? 0.1
  //   tx1.CurBuy === 'ETH' ? 0.02
  //   : 0
  return Math.abs(z(tx1.Buy) - z(tx2.Sell)) <= 0.2 &&
         Math.abs(z(tx1.Sell) - z(tx2.Buy)) <= 0.2
}

// checks if a tx is too small to count based on a token-specific size
const tooSmallToCount = tx => {
  const tooSmallAmount =
    tx.CurBuy === 'BTC' ? 0.0001 :
    tx.CurBuy === 'ETH' ? 0.001 :
    0.005
  return z(tx.Buy) < tooSmallAmount &&
         z(tx.Sell) < tooSmallAmount
}

// checks if two transactions are a Deposit/Withdrawal match
const match = (tx1, tx2) =>
  tx1.Type === otherType(tx2.Type) &&
  tx1.CurBuy === tx2.CurSell &&
  tx1.CurSell === tx2.CurBuy &&
  closeEnough(tx1, tx2)

/****************************************************************
* RUN
*****************************************************************/

if (!process.argv[2]) {
  console.error('Please specify a file')
  process.exit(1)
}

// import csv
csvtojson().fromFile(process.argv[2]).then(rawData => {

  // index by day
  const txsByDay = {}
  for (let i=0; i<rawData.length; i++) {
    const key = day(rawData[i])
    if (!(key in txsByDay)) {
      txsByDay[key] = []
    }
    txsByDay[key].push(rawData[i])
  }

  // separate out d&w that match on a given day
  const matched = []
  const unmatched = []
  const withdrawals = []

  // loop through each day
  for (let day in txsByDay) {
    const group = txsByDay[day]

    // loop through each transaction
    txLoop:
    for (let i in group) {
      const tx1 = group[i]

      // disable tooSmallToCount as there are not that many total deposits
      if (tx1.Type !== 'Deposit' || tooSmallToCount(tx1)) {
        withdrawals.push(tx1)
        continue
      }

      // loop through each other transaction
      for (let i2 in group) {
        const tx2 = group[i2]
        // match negligible transactions
        if(match(tx1, tx2)) {
          matched.push(tx1)
          continue txLoop // jump to next tx
        }
      }
      unmatched.push(tx1)
    }
  }

  // output
  if (process.argv[3] === 'summary') {
    console.log('Transactions: ', rawData.length)
    console.log('Total Days: ', Object.keys(txsByDay).length)
    console.log('Withdrawals: ', withdrawals.length)
    console.log('Matched Deposits: ', matched.length)
    console.log('Unmatched Deposits: ', unmatched.length)
  }
  else {
    console.log(json2csv.parse(unmatched, {
      delimiter: '\t',
      quote: '',
      fields: null
    }))
  }
})
