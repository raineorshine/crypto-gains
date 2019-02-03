const fs = require('fs')
const csvtojson = require('csvtojson')
const json2csv = require('json2csv')
const got = require('got')
const secure = require('./secure.json')
const memoize = require('p-memoize')

const sampleSize = 0

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
  const url = `https://min-api.cryptocompare.com/data/pricehistorical?fsym=${from}&tsyms=${to}&ts=${(new Date(time)).getTime()/1000}&api_key=${secure.cryptoCompareApiKey}&extraParams=cost-basis-filler`
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

let input = fs.readFileSync(process.argv[2], 'utf-8')
// replace double Cur. with CurBuy and CurSell
// RESUME
const lines = input.split('\n')
const inputCorrected = [].concat(
  lines[0]
    .replace('Cur.', 'CurBuy').replace('Cur.', 'CurSell'),
  lines.slice(1)
).join('\n')
const rawData = await csvtojson().fromString(inputCorrected)

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

// loop through each day
start:
for (let key in txsByDay) {
  const group = txsByDay[key]

  // loop through each transaction
  txLoop:
  for (let i in group) {
    const tx1 = group[i]

    // disable tooSmallToCount as there are not that many total deposits
    if (tx1.Type !== 'Deposit' || tooSmallToCount(tx1) || tx1.CurBuy === 'USD') {
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

    if (command === 'prices') {
      unmatchedRequests.push(async () => {
        let p, err
        try {
          p = await price(tx1.CurBuy, 'USD', day(normalDate(tx1)))
        }
        catch (e) {
          err = e.message
        }

        return {
          tx: Object.assign({}, tx1, {
            // per-day memoization
            Type: 'Income',
            Price: p
          }),
          error: err
        }
      })
    }
    else if (!sampleSize || unmatched.length < sampleSize) {
      unmatched.push(Object.assign({}, tx1, {
        Type: 'Income'
      }))
    }
    // ignore txs beyond sampleSize
  }

}

// summary
if (command === 'summary') {
  console.log('Transactions: ', rawData.length)
  console.log('Total Days: ', Object.keys(txsByDay).length)
  console.log('Withdrawals: ', withdrawals.length)
  console.log('Matched Deposits: ', matched.length)
  console.log('Unmatched Deposits: ', rawData.length - withdrawals.length - matched.length)
}
else {

  // prices
  if (command === 'prices') {
    const ProgressBar = require('progress')

    let errors = []

    if (sampleSize) {
      console.warn(`Sampling ${sampleSize} of ${unmatchedRequests.length} transactions.`)
    }

    const numRequests = Math.min(unmatchedRequests.length, sampleSize !== undefined ? sampleSize : Infinity)
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
    delimiter: '\t',
    quote: '',
    fields: null
  })
  const csvLines = csv.split('\n')
  const csvCorrected = [].concat(
    csvLines[0].replace('CurBuy', 'Cur.').replace('CurSell', 'Cur.'),
    csvLines.slice(1)
  ).join('\n')
  console.log(csvCorrected)
}

})()
