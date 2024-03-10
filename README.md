Calculates capital gains from cryptocurrency trades.

Historical prices provided by the [cryptocompare API](https://min-api.cryptocompare.com/documentation?key=Historical&cat=dataPriceHistorical).

## Usage

```sh
./bin.js --accounting lifo --output ./out <csv file or directory> [options]
```

- Reads a csv file of transactions (or a directory of csv files)
  - Supports the trade history export format from [CoinTracking](https://cointracking.info/trades.php) or [Kraken](https://www.kraken.com/u/history/export).
  - Transactions must be sorted by trade date (oldest to newest).
  - See [sample-data.csv](https://github.com/raineorshine/cost-basis-filler/blob/master/sample-data.csv) for a sample CoinTracking trade history file.
- Outputs csv with gains for each year
  - `,Type,Buy,Cur.,Sell,Cur.,Exchange,Trade Group,Comment,Trade Date`

## Installation

1. Clone the repo.
2. Rename sample-secure.json to secure.json and add valid API keys, icos (optional), and airdrop tokens to ignore (optional)

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

Withdrawals: 449
Matched Deposits: 755
Unmatched Deposits: 399
Crypto-to-USD: 3496
USD-to-Crypto: 139
USD Deposits: 12
Airdrops 127
Income: 134
Trades: 3682
Margin Trades: 974
Lending: 698
TOTAL: 10865 ✓

ERRORS
No available purchase: 3
No matching withdrawals: 399
Price errors: 0

2016 Like-Kind Exchange Deferred Gains (238) $10,000
2016 Short-Term Sales (622): $2,000
2016 Long-Term Sales (0): $2,000
2016 Interest (0): $0

2017 Like-Kind Exchange Deferred Gains (5628) $20,000
2017 Short-Term Sales (2437): $10,000
2017 Long-Term Sales (340): $12,000
2017 Interest (674): $5,000

2018 Like-Kind Exchange Deferred Gains (0) $0
2018 Short-Term Sales (1729): $20,000
2018 Long-Term Sales (343): $4,000
2018 Interest (24): $50

2019 Like-Kind Exchange Deferred Gains (0) $0
2019 Short-Term Sales (80): $-10,000
2019 Long-Term Sales (0): $0
2019 Interest (0): $0
```
