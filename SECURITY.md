# Security

## Found a vulnerability

Tell us before you tell the world: **security@tavarov.com**

We answer within three days. If you hear nothing, the mail did not arrive —
write again through the form on tavarov.com.

Please hold off on publishing until we have had a chance to close it. Other
people's money is involved, and a day of quiet is worth more here than being
first to post.

*По-русски: [SECURITY.ru.md](SECURITY.ru.md)*

## What we will NEVER ask for

* your twelve-word seed phrase — not to "verify" it, not to "restore" it, not
  for anything;
* your thirteenth word;
* your wallet password;
* your private key.

Anyone asking for these in the name of Tavarov is a fraud. No exceptions.

## What you should know about our threat model

**The wallet is a web page.** Whoever controls the domain and the hosting can
replace the app with one that steals the phrase as you type your password.
This is true of every web wallet and we are not going to pretend otherwise.
Which is why: you can download the app from this repository and open it from
disk — then it depends on neither our domain nor us.

**The contracts have not been audited.** The source is public and verified
against the bytecode on bscscan, but that is not the same as review by
specialists. Until there is an audit, keep amounts whose loss would not be a
disaster.

**One wallet owns the contracts.** It can change the fee (never above 2%), the
treasury address and the list of accepted currencies. It cannot take a
merchant's revenue and cannot touch the points already awarded.

**A plain transfer is not the same as paying an invoice.** If a buyer sends
money straight to the merchant's address, bypassing the contract, the transfer
carries no invoice number — there is nowhere to put one. We match such a
payment by currency, amount and time, which means two identical invoices to
the same merchant can be closed by one transfer. At a till, where an invoice
lives for minutes, that is rare — but you should know it.
