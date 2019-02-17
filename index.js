const fs = require('fs')
const csvtojson = require('csvtojson')
const json2csv = require('json2csv')
const got = require('got')
const secure = require('./secure.json')
const memoize = require('p-memoize')
const stock = require('./stock.js')()

const exchange = 'cccagg' // cryptocompare aggregrate
const sampleSize = Infinity

// get the day of the date
const day = date => date.split(' ')[0]

// convert to y-m-d
const normalDate = tx => {
  const d = tx['Trade Date']
  return `${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)} ${d.slice(11)}`
  // 18.06.2016 15:14 0
}

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

const price = memoize(async (from, to, time) => {
  const url = `https://min-api.cryptocompare.com/data/pricehistorical?fsym=${from}&tsyms=${to}&ts=${(new Date(time)).getTime()/1000}&e=${exchange}&api_key=${secure.cryptoCompareApiKey}&extraParams=cost-basis-filler`
  const data = JSON.parse((await got(url))
  .body)

  if (data[from]) {
    return data[from][to]
  }
  else if (data.Message.startsWith('There is no data for the symbol')) {
    throw new Error(`No price for ${from} on ${time}`)
  }
  else if (data.Response === 'Error') {
    throw new Error(data.Message)
  }
  else {
    throw new Error('Unknown Response', data)
  }
})



/****************************************************************
* RUN
*****************************************************************/

const file = process.argv[2]
const command = process.argv[3]

if (!file) {
  console.error('Please specify a file')
  process.exit(1)
}

// import csv

(async () => {

let input = fs.readFileSync(file, 'utf-8')
// replace double Cur. with CurBuy and CurSell
// RESUME
const lines = input.split('\n')
const inputCorrected = [].concat(
  lines[0]
    .replace('Cur.', 'CurBuy').replace('Cur.', 'CurSell'),
  lines.slice(1)
).join('\n')
const rawData = await csvtojson().fromString(inputCorrected) // indexed object; not a true array

// index by day
const txsByDay = {}
for (let i=0; i<rawData.length; i++) {
  const key = day(rawData[i]['Trade Date'])
  if (!(key in txsByDay)) {
    txsByDay[key] = []
  }
  txsByDay[key].push(rawData[i])
}

// separate out d&w that match on a given day
const matched = []
const withdrawals = []
const unmatchedRequests = [] // thunks for prices
const unmatched = []
const margin = []
const lending = []
let trades = []
let sales = []

// loop through each day
start:
for (let key in txsByDay) {
  const group = txsByDay[key]

  // loop through each transaction
  txLoop:
  for (let i in group) {
    const tx1 = group[i]

    // if (tx1['Trade Group'] === 'Lending') {
    //   console.log("tx1", tx1)
    // }

    // ignore lending
    if(/lending/i.test(tx1['Trade Group']) || /lending/i.test(tx1.Comment)) {
      lending.push(tx1)
      continue
    }
    // ignore margin
    else if(/margin/i.test(tx1['Trade Group']) || /margin/i.test(tx1.Comment)) {
      margin.push(tx1)
      continue
    }
    // disable tooSmallToCount as there are not that many total deposits
    else if (tx1.Type !== 'Deposit' || tooSmallToCount(tx1) || tx1.CurBuy === 'USD') {
      withdrawals.push(tx1)
      continue
    }

    // loop through each other transaction
    for (let i2 in group) {
      const tx2 = group[i2]
      // match negligible transactions
      if(match(tx1, tx2)) {
        matched.push(tx1)
        tx1.match = tx2
        continue txLoop // jump to next tx
      }
    }

    // otherwise we have an unmatched transaction
    delete tx1.field1

    const newTx = Object.assign({}, tx1, {
      Type: 'Income',
      Comment: 'Cost Basis',
      Group: ''
    })

    if (command === 'prices') {
      unmatchedRequests.push(async () => {
        let p, err
        try {
          // per-day memoization
          p = await price(tx1.CurBuy, 'USD', day(normalDate(tx1)))
        }
        catch (e) {
          err = e.message
        }

        return {
          tx: Object.assign({}, newTx, { Price: p }),
          error: err
        }
      })
    }
    // ignore txs beyond sampleSize
    else if (command !== 'sample' || unmatched.length < sampleSize) {
      unmatched.push(newTx)
    }
  }

}

const numUnmatched = rawData.length - withdrawals.length - matched.length - margin.length - lending.length

// summary
if (command === 'summary') {
  console.log('Transactions:', rawData.length)
  console.log('Total Days:', Object.keys(txsByDay).length)
  console.log('Margin Trades:', margin.length)
  console.log('Lending:', lending.length)
  console.log('Withdrawals:', withdrawals.length)
  console.log('Matched Deposits:', matched.length)
  console.log('Unmatched Deposits:', numUnmatched)
}

// costbasis
else if (command === 'costbasis') {

  const n = Math.min(rawData.length, sampleSize)
  const errors = []

  for (let i=0; i<n; i++) {
    const tx = rawData[i]

    // ignore "Cost Basis" transactions which were added for the CoinTracking tax report
    // they are duplicates to unmatched deposits, which we can derive the cost basis of
    if (tx.Comment === 'Cost Basis') {
      continue
    }

    // if (tx.CurBuy) {
    //   console.log("balance", tx.CurBuy, stock.balance(tx.CurBuy))
    // }
    // if (tx.CurSell) {
    //   console.log("balance", tx.CurSell, stock.balance(tx.CurSell))
    // }
    // console.log("tx", tx)
    switch(tx.Type) {
      case 'Withdrawal':
        // ignore USD withdrawals
        // ignore transactions processed via an out-of-order deposit
        if (tx.CurSell !== 'USD' && !tx.processed) {
          // store the cost basis (1 or more) of the withdrawal in the Withdrawal tx object so that the matching Deposit tx has access to the cost basis
          try {
            tx.processed = true
            tx.withdrawals = stock.withdraw(+tx.Sell, tx.CurSell, tx['Trade Date'])
            // console.log("tx.withdrawals", +tx.Sell, tx.withdrawals)
          }
          catch (e) {
            console.error('ERROR', e.message)
            errors.push(e)
          }
        }
        // TODO: process pending deposit
        break
      case 'Deposit':
        // USD cost basis = buy amount
        if (tx.CurBuy === 'USD') {
          // stock.deposit(+tx.Buy, tx.CurBuy, +tx.Buy, tx['Trade Date'])
          // ignore USD deposits
        }
        // get the cost basis from matching deposits
        else if (tx.match) {

          // if we get a deposit before its matching withdrawal, go ahead and process the withdrawal now
          if (!tx.match.processed) {
            // console.log("Processing out-of-order deposit with", tx.match)
            try {
              tx.match.processed = true
              tx.match.withdrawals = stock.withdraw(+tx.match.Sell, tx.match.CurSell, tx.match['Trade Date'])
            }
            catch (e) {
              console.error('ERROR', e.message)
              errors.push(e)
            }
          }

          if (tx.match.withdrawals) {
            tx.match.withdrawals.forEach(withdrawal => {
              stock.deposit(withdrawal.amount, withdrawal.cur, withdrawal.cost, withdrawal.date)
            })
          }
          else {
            console.error(`ERROR: Matching deposit of ${tx.Buy} ${tx.CurBuy} on ${tx['Trade Date']} with no withdrawals.`)
            errors.push(tx)
          }
        }
        else {
          console.warn(`WARNING: No matching withdrawal for deposit of ${tx.Buy} ${tx.CurBuy} on ${tx['Trade Date']}. Using historical price.`)
          let p = 0
          try {
            p = await price(tx.CurBuy, 'USD', day(normalDate(tx)))
          }
          stock.deposit(+tx.Buy, tx.CurBuy, tx.Buy * p, tx['Trade Date'])
          // errors.push('No matching withdrawal for deposit')
        }

        break
      case 'Trade':
        try {
          const tradeExchanges = stock.trade(+tx.Sell, tx.CurSell, +tx.Buy, tx.CurBuy, tx['Trade Date'])
          if (tx.CurBuy === 'USD') {
            sales = sales.concat(tradeExchanges)
          }
          else {
            trades = trades.concat(tradeExchanges)
          }
        }
        catch (e) {
          console.error('ERROR', e.message)
          errors.push(e)
        }
        break
      case 'Income':
        let p = 0
        try {
          p = await price(tx.CurBuy, 'USD', day(normalDate(tx)))
        }
        stock.deposit(+tx.Buy, tx.CurBuy, tx.Buy * p, tx['Trade Date'])
        break
    }
  }

  console.log('trades', trades.length)
  console.log('sales', sales.length)
  console.log('errors', errors.length)
}

// default
else {

  if (command === 'sample') {
    console.warn(`Sampling ${sampleSize} of ${numUnmatched} transactions.`)
  }

  // prices
  if (command === 'prices') {
    const ProgressBar = require('progress')

    const errors = []

    const numRequests = Math.min(unmatchedRequests.length, sampleSize)
    const bar = new ProgressBar(':current/:total :percent :etas (:token1 errors)', { total: numRequests })
    for (let i=0; i<numRequests; i++) {
      const result = await unmatchedRequests[i]()
      if (!result.error) {
        unmatched.push(result.tx)
      }
      else {
        errors.push(result.error)
      }
      bar.tick({ token1: errors.length })
    }

    if (errors.length > 0) {
      console.warn(errors.join('\n'))
    }
  }

  // output
  const csv = json2csv.parse(unmatched, {
    delimiter: ',',
    fields: ['Type','Buy','CurBuy','Sell','CurSell','Exchange','Trade Group',,,'Comment','Trade Date']
  })
  const csvLines = csv.split('\n')
  const csvCorrected = [].concat(
    csvLines[0].replace('CurBuy', 'Cur.').replace('CurSell', 'Cur.'),
    csvLines.slice(1)
  ).join('\n')
  console.log(csvCorrected)
}

})()
