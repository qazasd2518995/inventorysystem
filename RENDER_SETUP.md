
#14 exporting cache to client directory
#14 preparing build cache for export
#14 writing cache manifest sha256:41e4dd025cfc7b5cbcd8e6c193ccff8796650af1f2146dfd68dae057231f165f done
#14 DONE 0.0s
Pushing image to registry...
Upload succeeded
==> Deploying...
> yahoo-auction-exporter@1.0.0 start
> node server.js
/app/server.js:1624
        browser = await puppeteer.launch({
                  ^^^^^
SyntaxError: await is only valid in async functions and the top level bodies of modules
    at wrapSafe (node:internal/modules/cjs/loader:1472:18)
    at Module._compile (node:internal/modules/cjs/loader:1501:20)
    at Module._extensions..js (node:internal/modules/cjs/loader:1613:10)
    at Module.load (node:internal/modules/cjs/loader:1275:32)
    at Module._load (node:internal/modules/cjs/loader:1096:12)
    at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:164:12)
    at node:internal/main/run_main_module:28:49
Node.js v20.19.4
> yahoo-auction-exporter@1.0.0 start
> node server.js
/app/server.js:1624
        browser = await puppeteer.launch({
                  ^^^^^
SyntaxError: await is only valid in async functions and the top level bodies of modules
    at wrapSafe (node:internal/modules/cjs/loader:1472:18)
    at Module._compile (node:internal/modules/cjs/loader:1501:20)
    at Module._extensions..js (node:internal/modules/cjs/loader:1613:10)
    at Module.load (node:internal/modules/cjs/loader:1275:32)
    at Module._load (node:internal/modules/cjs/loader:1096:12)
    at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:164:12)
    at node:internal/main/run_main_module:28:49
Node.js v20.19.4