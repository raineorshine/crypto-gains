Generate missing cost basis for unknown crypto deposits from day-of historical price.

    $ node index.js data.csv

    402/402 100% 0.0s (0 errors)
    field1  Type  Buy CurBuy  Sell  CurSell Exchange  Trade Group Comment Trade Date  Price
    Deposit 0.00059200  BTC -   Coinbase      06.04.2016 08:47  421.26
    Deposit 27.25163848 BTC -   Coinbase      20.05.2016 16:46  442.11
    Deposit 0.63300000  BTC -   Kraken  Kraken Ledger   18.06.2016 15:14  753.77
    ...

    $ node index.js data.csv summary

    Transactions:  4879
    Total Days:  791
    Withdrawals:  3913
    Matched Deposits:  564
    Unmatched Deposits:  402

If a symbol cannot be found, errors will be shown and the price will be empty:

    402/402 100% 0.0s (2 errors)
    No price for BLOOBLOO on 2018-12-11
    No price for BLOGBING on 2018-12-13
    field1  Type  Buy CurBuy  Sell  CurSell Exchange  Trade Group Comment Trade Date  Price
    Deposit 1.00000000  BLOOBLOO -   Coinssss      11.12.2018 00:00
    Deposit 10.00000000 BLOGBING -   Coinssss      13.12.2018 00:00
    Deposit 0.63300000  BTC -   Kraken  Kraken Ledger   18.06.2016 15:14  753.77

## Installation

1. Clone the repo.
2. Rename sample-secure.json to secure.json and add valid API keys.
3. [sample-data.csv](https://github.com/raineorshine/cost-basis-filler/blob/master/sample-data.csv) is from [cointracking.info/trades](https://cointracking.info/trades.php). Rename the duplicate "Cur." in header to "CurBuy" and "CurSell".
