Calculates capital gains from cryptocurrency trades.

Historical prices provided by the [cryptocompare API](https://min-api.cryptocompare.com/documentation?key=Historical&cat=dataPriceHistorical). e.g. https://min-api.cryptocompare.com/documentation?key=Historical&cat=dataPriceHistorical&api_key=API_KEY

## Usage

```sh
./bin.js --accounting lifo --output ./out <csv file or directory> [options]
```

- Reads a csv file of transactions (or a directory of csv files)
  - Supports the trade history export format from [CoinTracking](https://cointracking.info/trades.php), [Kraken](https://www.kraken.com/u/history/export), [Gemini](https://exchange.gemini.com/settings/documents/transaction-history), Uniswap (via Koinly), and Ledger Live operations history.
  - See [sample-data.csv](https://github.com/raineorshine/cost-basis-filler/blob/master/sample-data.csv) for a sample CoinTracking trade history file.
- Outputs csv with gains for each year
  - `,Type,Buy,Cur.,Sell,Cur.,Exchange,Trade Group,Comment,Trade Date`

### Yearly Tax Routine

1. Download one year of trades from Gemini. (Might need to add support for xlsx in 2025, because Gemini seems to no longer export CSV.)
2. Download one year of trades from defi exchanges such as Uniswap.
3. Download one year of transactions from the Ledger Live operations log.

## Installation

1. Clone the repo.
2. Rename sample-secure.json to secure.json and add valid API keys and icos (optional)

## Options

```sh
  --accounting  Accounting type: fifo/lifo.                [lifo|fifo (default)]
  --help        Show help                                              [boolean]
  --likekind    Allow like-kind exchange before 2018.            [default: true]
  --limit       Limit number of transactions processed.      [default: Infinity]
  --output      Output directory for results.                 [default: dry run]
  --verbose     Show more errors and warnings.
  --version     Show version number                                    [boolean]
```

## Example

```sh
$ ./bin.js --accounting lifo --output ./out ./trades

Deposits: 720
Withdrawals: 449
Crypto sales: 3496
Crypto purchases: 139
USD Deposits: 12
Airdrops 127
Income: 134
Rebates: 415
Trades: 3682
Margin Trades: 974
Lending: 698
TOTAL: 10865 ✓

ERRORS
No available purchase: 3
Price errors: 0

STOCK (sample)
{
  ETH: 848.6415129234645,
  BTC: 155.0571421792017,
}

2016 Like-Kind Exchange Deferred Gains (238) $10,000
2016 Short-Term Sales (622): $2,000
2016 Long-Term Sales (0): $2,000

2017 Like-Kind Exchange Deferred Gains (5628) $20,000
2017 Short-Term Sales (2437): $10,000
2017 Long-Term Sales (340): $12,000
2017 Interest (674): $5,000

2018 Short-Term Sales (1729): $20,000
2018 Long-Term Sales (343): $4,000
2018 Interest (24): $50

2019 Short-Term Sales (80): $-10,000
2019 Long-Term Sales (0): $0
```

## ICO's

ICO participation can be manually added to secure.json. Just add the trade with the Buy and Sell amounts and the correct cost basis will be recorded.

## Airdrops

Airdrops are recorded as Deposits with a cost basis of zero. Possibly should be recoded as income. Airdropped symbols are defined in src/util/airdropSymbols.ts.

Does not distinguish between airdrops and other deposits of airdropped tokens. We could differentiate them by specifying a date range for the airdrop, but this is a low priority since I basically ignore airdropped tokens. If I actively traded them, it would be important to differentiate this to avoid resetting the cost basis on each teposit.

## Fallback Price

You can define a fallback price to use on trades that have a missing cost basis. This can occur if there are any missing transactions in the trade history such as an internal transfer to a different wallet, a bridget token, or an unrecorded trade on a defi exchange.

Choose the lowest plausible price to avoid undercalculating gains and underpaying taxes. For example, the price of the asset when you first started trading. This could be way off the actual cost basis in which case you will overpay, but at least it is better than a zero cost basis.

```json
  "fallbackPrice": {
    "BTC": 400,
    "ETH": 40
  }
```

## Errors

- **No matching withdrawals** - Indicates a matching withdrawal was not found for a deposit, so its cost basis is unknown. This will default to the historical price at the time of the deposit, which is not correct but will allow the script to at least complete. If the cost basis should be lower, this could result in undercalculating gains and should be investigated. Run with `--verbose` to show individual warning messages.
  - e.g. WARNING: No matching withdrawal for deposit of 1 SLV on 08.01.2019 09:00. Using historical price.

## To Do

- Staking rewards
