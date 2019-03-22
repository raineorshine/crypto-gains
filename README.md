Generate missing cost basis for unknown crypto deposits from [day-of historical price](https://min-api.cryptocompare.com/documentation?key=Historical&cat=dataPriceHistorical).

    $ node index.js data.csv costbasis

    402/402 100% 0.0s (0 errors)
    Type  Buy Cur.  Sell  Cur. Exchange  Trade Group Comment Trade Date
    "Type","Buy","Cur.","Sell","Cur.","Exchange","Trade Group",,,"Comment","Trade Date"
    "Income","0.00059200","BTC","-","","Coinbase","",,,"Cost Basis","06.04.2016 08:47"
    "Income","27.25163848","BTC","-","","Coinbase","",,,"Cost Basis","20.05.2016 16:46"
    "Income","0.63300000","BTC","-","","Kraken","Kraken Ledger",,,"Cost Basis","18.06.2016 15:14"
    ...

    $ node index.js data.csv summary

    Transactions:  4879
    Total Days:  791
    Withdrawals:  3913
    Matched Deposits:  564
    Unmatched Deposits:  402

Calculate prices from cryptocompare aggregrate (cccagg):

    $ node index.js data.csv prices

    402/402 100% 0.0s (0 errors)
    Type  Buy Cur.  Sell  Cur. Exchange  Trade Group Comment Trade Date  Price
    "Type","Buy","Cur.","Sell","Cur.","Exchange","Trade Group",,,"Comment","Trade Date"
    "Income","0.00059200","BTC","-","","Coinbase","",,,"Cost Basis","06.04.2016 08:47"
    "Income","27.25163848","BTC","-","","Coinbase","",,,"Cost Basis","20.05.2016 16:46"
    "Income","0.63300000","BTC","-","","Kraken","Kraken Ledger",,,"Cost Basis","18.06.2016 15:14". "753.77"
    ...

If a symbol cannot be found, errors will be shown and the price will be empty:

    402/402 100% 0.0s (2 errors)
    No price for BLOOBLOO on 2018-12-11
    No price for BLOGBING on 2018-12-13
    Type  Buy Cur.  Sell  Cur.Sell Exchange  Trade Group Comment Trade Date  Price
    "Income","1.00000000","BLOOBLOO","-","Coinssss","",,"11.12.2018 00:00"
    "Income","10.00000000",BLOGBING","-","Coinssss","",,"13.12.2018 00:00"
    "Income","0.63300000","BTC","-","Kraken","Krakenger","18.06.2016 15:14"  "753.77"

Use `all.js` to calculate prices and totals (amount * price) for every transaction. Calculates prices from Coinbase.

    $ node all.js data.csv

    11/11 100% 0.0s (0 errors)
    "Type","Buy","Cur.","Sell","Cur.","Price","Total","Exchange","Trade Group",,,"Comment","Trade Date"
    "Withdrawal","-","","3.97977742","ETH",378.85,1507.7386755670002,"Coinbase","",,,"","01.04.2018 21:53"
    "Withdrawal","-","","3.23510857","ETH",303.7,982.5024727089999,"Coinbase","",,,"","04.09.2017 08:46"
    "Withdrawal","-","","2.82298340","ETH",404.95,1143.16712783,"Coinbase","",,,"","06.08.2018 22:51"
    ...

## Installation

1. Clone the repo.
2. Rename sample-secure.json to secure.json and add valid API keys.
3. [sample-data.csv](https://github.com/raineorshine/cost-basis-filler/blob/master/sample-data.csv) is from [cointracking.info/trades](https://cointracking.info/trades.php).
