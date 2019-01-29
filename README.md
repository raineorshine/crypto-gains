Generate missing cost basis for unknown crypto purchases from day-of historical price.

    $ node index.js d&w.csv summary

    Deposit  -   5.02621700  ETH Kraken
    Deposit  -   0.00103300  BTC Coinbase
    Deposit  -   0.33081900  BTC Coinbase
    ...

    $ node index.js d&w.csv summary

    Transactions:  4879
    Total Days:  791
    Withdrawals:  3913
    Matched Deposits:  564
    Unmatched Deposits:  402

## Installation

1. Rename secure-sample.json to secure.json and add valid API keys.
2. [sample-d&w.csv](https://github.com/raineorshine/cost-basis-filler/blob/master/sample-d%26w.csv) is from [cointracking.info/trades](https://cointracking.info/trades.php). Rename the duplicate "Cur." in header to "CurBuy" and "CurSell".
3. Clone the repo.
