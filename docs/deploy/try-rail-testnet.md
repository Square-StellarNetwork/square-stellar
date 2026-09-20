# The TRY rail on stellar:testnet

Run at 2026-09-20T04:38:04.444Z against `tr-mock-anchor.fly.dev`, whose **bank leg is simulated**: no lira
moves anywhere. What it pays is Circle's real testnet USDC, and every request below is a real
SEP request answered by a real service.

| | |
|---|---|
| Kernel | `CCOT26XWSUXQZUSEEVFCP5PMSF5AJEL2L764CSLQPEATVCKFRQLK2LH3` |
| Token | USDC `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| Anchor | `tr-mock-anchor.fly.dev` |
| Settlement leg | not run — the anchor had not paid enough yet |

| Step | What happened | Transaction |
|---|---|---|
| accounts | client GBIZNA66H7XQGV7CYISHRRBNEDV2QSADCGD7KXNV5YPUGJOVSLJVLYH6, provider GAFFFRF5IDHVMINWSAX2PSGOFNVIEWTNALPMR2QH6B47DHSYUR34CS34 (Friendbot) |  |
| trustline (client) | accepting USDC | [`9e717c3c…`](https://stellar.expert/explorer/testnet/tx/9e717c3cfc7d94d52b4f4603bf8adf60c89c74f351bdd5372881b0844c00993e) |
| trustline (provider) | accepting USDC | [`552c2700…`](https://stellar.expert/explorer/testnet/tx/552c27000e31ed40b9914f04b9316649973c8b4f2b1821b269ee530ee588f59e) |
| SEP-10 | signed in as GBIZNA66H7XQGV7CYISHRRBNEDV2QSADCGD7KXNV5YPUGJOVSLJVLYH6 |  |
| SEP-38 | 250 TRY → 5.0990227 USDC at 48.785078 |  |
| SEP-6 deposit | 250 TRY, transaction sep_ac98otmm2ht1xct38cqw |  |
| the bank leg | simulated on the anchor's own page (200) |  |
| SEP-6 follow | still pending after 420 s: tr-mock-anchor.fly.dev: SEP-6 transaction: sep_ac98otmm2ht1xct38cqw is still pending_anchor after 420000 ms |  |
| balance | 0 → 0 USDC |  |
| stopped | the anchor has not paid enough to fund a 1 USDC job yet; the settlement leg is not run |  |
