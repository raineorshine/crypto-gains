const fs = require('fs')
const csvtojson = require('csvtojson')
const json2csv = require('json2csv')
const got = require('got')
const secure = require('./secure.json')
const memoize = require('p-memoize')

const exchange = 'coinbase'

// get the day of the date
const day = date => date.split(' ')[0]

// convert to y-m-d
const normalDate = tx => {
  const d = tx['Trade Date']
  return `${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)} ${d.slice(11)}`
  // 18.06.2016 15:14 0
}

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
const rawData = await csvtojson().fromString(inputCorrected)
console.warn('Transactions:', rawData.length)

console.log('"i", "Type","Buy","Cur.","Sell","Cur.","Price","Total","Exchange","Trade Group",,,"Comment","Trade Date"')

for (let i=0; i<rawData.length; i++) {

  const tx = rawData[i]

  // generate price request (thunks)
  const request = async () => {
    let p, err
    try {
      // per-day memoization
      p = await price(tx.CurSell, 'USD', day(normalDate(tx)))
    }
    catch (e) {
      err = e.message
    }

    return {
      tx: Object.assign({}, tx, {
        i,
        Price: p,
        Total: +tx.Sell * p
      }),
      error: err
    }
  }

  // output tx with price or error
  const result = await request()
  if (!result.error) {
    const csv = json2csv.parse([result.tx], {
      delimiter: ',',
      fields: ['i', 'Type','Buy','CurBuy','Sell','CurSell','Price','Total','Exchange','Trade Group',,,'Comment','Trade Date']
    })
    // remove header
    const csvWithoutHeader = csv.split('\n').slice(1).join('\n')
    console.log(csvWithoutHeader)
  }
  else {
    console.error(result.error)
  }
}

})()
